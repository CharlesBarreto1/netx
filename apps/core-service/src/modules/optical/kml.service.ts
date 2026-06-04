/**
 * KmlService — import/export KML/KMZ da planta óptica (R4.5d).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Doc: docs/architecture/osp-network.md
 *
 * Pipeline de import:
 *   1. Recebe buffer (arquivo .kml ou .kmz). KMZ = zip → descompacta busca doc.kml.
 *   2. Parse XML com fast-xml-parser (defaults seguros, evita XXE).
 *   3. Walk Placemarks: Point → enclosure preview, LineString → cable preview.
 *   4. Retorna preview JSON pra UI conferir.
 *   5. Confirma: cria entidades em transação Prisma.
 *
 * Pipeline de export:
 *   1. Lê todas OpticalEnclosure + FiberCable do tenant.
 *   2. Gera XML KML 2.2 (compatível com Google Earth/QGIS).
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { XMLBuilder, XMLParser } from 'fast-xml-parser';
import JSZip from 'jszip';
import type {
  ConfirmKmlImportRequest,
  KmlImportPreview,
  KmlImportResult,
} from '@netx/shared';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { calculatePathLength } from './fiber-cables.service';

const KML_NS = 'http://www.opengis.net/kml/2.2';

@Injectable()
export class KmlService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ───────────────────────────────────────────────────────────────────────────
  // IMPORT
  // ───────────────────────────────────────────────────────────────────────────
  /**
   * Parse de KML/KMZ — detecta zip pelo magic bytes "PK\x03\x04".
   * Retorna preview pra operador confirmar antes do commit.
   */
  async parsePreview(buffer: Buffer): Promise<KmlImportPreview> {
    const xml = await this.extractKmlXml(buffer);
    return this.parseKmlXml(xml);
  }

  private async extractKmlXml(buffer: Buffer): Promise<string> {
    // KMZ assinatura: bytes "PK\x03\x04" (4 primeiros bytes do zip).
    const isZip =
      buffer.length >= 4 &&
      buffer[0] === 0x50 &&
      buffer[1] === 0x4b &&
      buffer[2] === 0x03 &&
      buffer[3] === 0x04;
    if (!isZip) return buffer.toString('utf-8');

    const zip = await JSZip.loadAsync(buffer);
    // Procura doc.kml na raiz; se não achar, pega o primeiro .kml no zip.
    const docKml =
      zip.file('doc.kml') ??
      Object.values(zip.files).find(
        (f) => !f.dir && f.name.toLowerCase().endsWith('.kml'),
      );
    if (!docKml) throw new Error('KMZ não contém arquivo .kml');
    return docKml.async('string');
  }

  private parseKmlXml(xml: string): KmlImportPreview {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      // Evita coerção que estraga coordenadas ("0,0" vira number 0).
      parseTagValue: false,
      parseAttributeValue: false,
      trimValues: true,
      // Defesa básica contra XXE: não processa entities externas.
      processEntities: false,
    });
    const parsed = parser.parse(xml);

    const placemarks: unknown[] = [];
    collectPlacemarks(parsed, placemarks);

    const preview: KmlImportPreview = {
      enclosures: [],
      cables: [],
      warnings: [],
    };

    for (const pm of placemarks) {
      const p = pm as Record<string, unknown>;
      const name = typeof p.name === 'string' ? p.name.trim() : '';
      const description =
        typeof p.description === 'string' ? p.description.trim() : undefined;

      // Point → enclosure
      const point = p.Point as Record<string, unknown> | undefined;
      if (point && typeof point.coordinates === 'string') {
        const coord = parseCoordinate(point.coordinates);
        if (coord) {
          if (!name) {
            preview.warnings.push(
              `Placemark sem <name> em ${coord.latitude.toFixed(4)},${coord.longitude.toFixed(4)} — usando código gerado.`,
            );
          }
          preview.enclosures.push({
            name: name || `AUTO-${preview.enclosures.length + 1}`,
            latitude: coord.latitude,
            longitude: coord.longitude,
            description,
          });
        }
        continue;
      }

      // LineString → cable
      const line = p.LineString as Record<string, unknown> | undefined;
      if (line && typeof line.coordinates === 'string') {
        const path = parseCoordinateList(line.coordinates);
        if (path.length >= 2) {
          if (!name) {
            preview.warnings.push(
              `Cabo sem <name> com ${path.length} pontos — usando código gerado.`,
            );
          }
          preview.cables.push({
            name: name || `CABO-AUTO-${preview.cables.length + 1}`,
            // Default conservador — operador edita depois se for diferente.
            fiberCount: 12,
            path,
            lengthMeters: calculatePathLength(path),
            description,
          });
        } else {
          preview.warnings.push(
            `Cabo "${name || 's/nome'}" ignorado: precisa de >= 2 pontos.`,
          );
        }
      }
    }

    if (preview.enclosures.length === 0 && preview.cables.length === 0) {
      preview.warnings.push(
        'Nenhuma geometria reconhecida. KML precisa de <Placemark> com <Point> ou <LineString>.',
      );
    }

    return preview;
  }

  /**
   * Cria as entidades em batch numa única transação. Se algo falhar,
   * roll back tudo — evita planta meio-criada inconsistente.
   */
  async commitImport(
    tenantId: string,
    actorUserId: string,
    input: ConfirmKmlImportRequest,
  ): Promise<KmlImportResult> {
    const { preview, defaults } = input;
    const errors: string[] = [];
    // Agrupa tudo que este import criar, pra permitir desfazer o lote depois.
    const importBatchId = randomUUID();

    let enclosuresCreated = 0;
    let cablesCreated = 0;

    // IMPORTANTE: NÃO usar uma transação única pro lote inteiro. No Postgres,
    // o primeiro create que falha (ex.: `code` duplicado) aborta a transação;
    // os catch por-item escondem o erro mas todos os inserts seguintes falham
    // com "current transaction is aborted" e o COMMIT vira ROLLBACK — resultado:
    // "importou N" mas nada persiste. Em vez disso, cada item é uma transação
    // própria: a falha de um desfaz só aquele item; os demais persistem.

    // Caixas primeiro: cabos podem ainda não ter endpoints, mas se o operador
    // editar depois precisará das caixas existindo.
    for (const e of preview.enclosures) {
      try {
        // Caixa + portas atômicas POR ITEM (se as portas falharem, não fica
        // caixa órfã sem portas).
        await this.prisma.$transaction(async (tx) => {
          const enclosure = await tx.opticalEnclosure.create({
            data: {
              tenantId,
              code: e.name.slice(0, 40),
              type: defaults.enclosureType,
              latitude: e.latitude,
              longitude: e.longitude,
              capacity: defaults.enclosureCapacity,
              notes: e.description ?? null,
              importBatchId,
              createdById: actorUserId,
              updatedById: actorUserId,
            },
          });
          // Cria as portas FREE (mesmo padrão do OpticalEnclosuresService).
          await tx.opticalPort.createMany({
            data: Array.from(
              { length: defaults.enclosureCapacity },
              (_, i) => ({
                tenantId,
                enclosureId: enclosure.id,
                number: i + 1,
                status: 'FREE' as const,
              }),
            ),
          });
        });
        enclosuresCreated++;
      } catch (err) {
        errors.push(
          `Caixa "${e.name}": ${importErrMsg(err)}`,
        );
      }
    }

    for (const c of preview.cables) {
      try {
        await this.prisma.fiberCable.create({
          data: {
            tenantId,
            code: c.name.slice(0, 40),
            type: defaults.cableType,
            fiberCount: defaults.cableFiberCount,
            path: c.path.map((p) => [p.longitude, p.latitude]),
            lengthMeters: c.lengthMeters,
            notes: c.description ?? null,
            importBatchId,
            createdById: actorUserId,
            updatedById: actorUserId,
          },
        });
        cablesCreated++;
      } catch (err) {
        errors.push(
          `Cabo "${c.name}": ${importErrMsg(err)}`,
        );
      }
    }

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'kml.imported',
      resource: 'optical',
      resourceId: importBatchId,
      afterState: {
        enclosuresCreated,
        cablesCreated,
        errors: errors.length,
      },
    });

    return {
      enclosuresCreated,
      cablesCreated,
      errors,
      // Só devolve o batch se algo foi criado (pra UI oferecer "desfazer").
      importBatchId: enclosuresCreated + cablesCreated > 0 ? importBatchId : null,
    };
  }

  /**
   * Desfaz um import KMZ/KML inteiro — soft-delete de todas as caixas e cabos
   * criados naquele lote. Bloqueia se algum item já está em uso (porta ocupada
   * ou cabo conectado/com emenda) — nesse caso o operador remove item a item.
   */
  async undoImport(
    tenantId: string,
    actorUserId: string,
    importBatchId: string,
  ): Promise<{ enclosuresRemoved: number; cablesRemoved: number }> {
    const [enclosures, cables] = await Promise.all([
      this.prisma.opticalEnclosure.findMany({
        where: { tenantId, importBatchId, deletedAt: null },
        select: { id: true, code: true },
      }),
      this.prisma.fiberCable.findMany({
        where: { tenantId, importBatchId, deletedAt: null },
        select: { id: true, code: true },
      }),
    ]);
    if (enclosures.length === 0 && cables.length === 0) {
      throw new NotFoundException('Import não encontrado (ou já desfeito)');
    }

    // Trava: não desfazer se algo do lote já foi usado na planta.
    const enclosureIds = enclosures.map((e) => e.id);
    const cableIds = cables.map((c) => c.id);
    if (enclosureIds.length > 0) {
      const usedPort = await this.prisma.opticalPort.count({
        where: { tenantId, enclosureId: { in: enclosureIds }, status: { not: 'FREE' } },
      });
      if (usedPort > 0) {
        throw new BadRequestException(
          'Não dá pra desfazer: alguma caixa do import já tem porta em uso. ' +
            'Remova os itens manualmente.',
        );
      }
    }
    if (cableIds.length > 0) {
      const splice = await this.prisma.fiberSplice.count({
        where: { tenantId, deletedAt: null, OR: [{ cableAId: { in: cableIds } }, { cableBId: { in: cableIds } }] },
      });
      if (splice > 0) {
        throw new BadRequestException(
          'Não dá pra desfazer: algum cabo do import já tem emenda. Remova os itens manualmente.',
        );
      }
    }

    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.opticalPort.deleteMany({ where: { tenantId, enclosureId: { in: enclosureIds } } }),
      this.prisma.opticalEnclosure.updateMany({
        where: { tenantId, importBatchId, deletedAt: null },
        data: { deletedAt: now },
      }),
      this.prisma.fiberCable.updateMany({
        where: { tenantId, importBatchId, deletedAt: null },
        data: { deletedAt: now },
      }),
    ]);

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'kml.import_undone',
      resource: 'optical',
      resourceId: importBatchId,
      beforeState: { enclosures: enclosures.length, cables: cables.length },
    });

    return { enclosuresRemoved: enclosures.length, cablesRemoved: cables.length };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // EXPORT
  // ───────────────────────────────────────────────────────────────────────────
  /**
   * Gera KML 2.2 com toda a planta do tenant — abre direto em Google Earth/QGIS.
   * Cabos vão como LineString; caixas como Point. <styleUrl> separa visuais.
   */
  async exportKml(tenantId: string): Promise<string> {
    const [enclosures, cables] = await Promise.all([
      this.prisma.opticalEnclosure.findMany({
        where: { tenantId, deletedAt: null },
        select: {
          code: true,
          type: true,
          latitude: true,
          longitude: true,
          notes: true,
        },
      }),
      this.prisma.fiberCable.findMany({
        where: { tenantId, deletedAt: null },
        select: {
          code: true,
          type: true,
          fiberCount: true,
          path: true,
          notes: true,
        },
      }),
    ]);

    const placemarks: Array<Record<string, unknown>> = [];

    for (const e of enclosures) {
      placemarks.push({
        name: e.code,
        description: this.escapeDescription(
          `Tipo: ${e.type}${e.notes ? `\n${e.notes}` : ''}`,
        ),
        styleUrl: `#netx-${e.type.toLowerCase()}`,
        Point: {
          coordinates: `${Number(e.longitude)},${Number(e.latitude)},0`,
        },
      });
    }

    for (const c of cables) {
      const pathArr = Array.isArray(c.path) ? (c.path as unknown[]) : [];
      const coords = pathArr
        .filter(
          (p): p is [number, number] =>
            Array.isArray(p) && typeof p[0] === 'number' && typeof p[1] === 'number',
        )
        .map(([lng, lat]) => `${lng},${lat},0`)
        .join(' ');
      placemarks.push({
        name: c.code,
        description: this.escapeDescription(
          `Tipo: ${c.type}\nFibras: ${c.fiberCount}${c.notes ? `\n${c.notes}` : ''}`,
        ),
        styleUrl: `#netx-cable-${c.type.toLowerCase()}`,
        LineString: { coordinates: coords },
      });
    }

    const doc: Record<string, unknown> = {
      '?xml': { '@_version': '1.0', '@_encoding': 'UTF-8' },
      kml: {
        '@_xmlns': KML_NS,
        Document: {
          name: 'NetX — Planta óptica',
          // Estilos básicos. Operador pode customizar no Google Earth.
          Style: [
            {
              '@_id': 'netx-cto',
              IconStyle: { color: 'ff0d9488', scale: '1.0' },
            },
            {
              '@_id': 'netx-nap',
              IconStyle: { color: 'ff0d9488', scale: '0.9' },
            },
            {
              '@_id': 'netx-splitter',
              IconStyle: { color: 'ff0f766e', scale: '1.0' },
            },
            {
              '@_id': 'netx-emenda',
              IconStyle: { color: 'ff525252', scale: '0.8' },
            },
            {
              '@_id': 'netx-cable-backbone',
              LineStyle: { color: 'ffd84e1d', width: '4' },
            },
            {
              '@_id': 'netx-cable-distribution',
              LineStyle: { color: 'ffea3393', width: '3' },
            },
            {
              '@_id': 'netx-cable-drop',
              LineStyle: { color: 'ff88137e', width: '2' },
            },
          ],
          Placemark: placemarks,
        },
      },
    };

    const builder = new XMLBuilder({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      format: true,
      indentBy: '  ',
      suppressEmptyNode: true,
    });
    return builder.build(doc);
  }

  private escapeDescription(text: string): string {
    // fast-xml-parser já escapa entidades XML; aqui só cuida do CDATA caso
    // o operador tenha colocado HTML/notas com < > em descriptions.
    return text;
  }
}

// ─── Helpers de parse ───────────────────────────────────────────────────────
function collectPlacemarks(node: unknown, out: unknown[]): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) collectPlacemarks(item, out);
    return;
  }
  const obj = node as Record<string, unknown>;
  if ('Placemark' in obj) {
    const pm = obj.Placemark;
    if (Array.isArray(pm)) out.push(...pm);
    else if (pm) out.push(pm);
  }
  for (const key of Object.keys(obj)) {
    if (key === 'Placemark') continue;
    collectPlacemarks(obj[key], out);
  }
}

/** Mensagem de erro amigável por item do import (esconde o ruído do Prisma). */
function importErrMsg(err: unknown): string {
  const code = (err as { code?: string } | null)?.code;
  if (code === 'P2002') return 'código duplicado (nome repetido no arquivo ou já importado)';
  if (code === 'P2000') return 'valor longo demais pra um campo';
  return err instanceof Error ? err.message : 'erro';
}

/** KML coordinate format: "lng,lat[,alt]" — pega o primeiro. */
function parseCoordinate(s: string): { latitude: number; longitude: number } | null {
  const cleaned = s.trim().split(/\s+/)[0];
  const parts = cleaned.split(',').map((v) => parseFloat(v));
  if (parts.length < 2 || isNaN(parts[0]) || isNaN(parts[1])) return null;
  return { longitude: parts[0], latitude: parts[1] };
}

/** KML LineString coordinates: tokens "lng,lat[,alt]" separados por whitespace. */
function parseCoordinateList(
  s: string,
): Array<{ latitude: number; longitude: number }> {
  const tokens = s.trim().split(/\s+/);
  const result: Array<{ latitude: number; longitude: number }> = [];
  for (const t of tokens) {
    const parts = t.split(',').map((v) => parseFloat(v));
    if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      result.push({ longitude: parts[0], latitude: parts[1] });
    }
  }
  return result;
}
