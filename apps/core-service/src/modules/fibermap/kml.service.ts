/**
 * FibermapKmlService — import/export KML/KMZ da planta (FM-7, spec §12).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Fluxo preview/commit SÍNCRONO (decisão nº7, padrão optical/kml.service):
 * parse puro em kml-io.ts; aqui a resolução contra o banco:
 *   - preview: colisões de nome na pasta destino + resolução best-effort das
 *     pontas dos cabos (pontos do próprio arquivo ou elemento ≤ 25 m);
 *   - commit: TRANSAÇÃO POR ITEM (uma falha não derruba o lote — lição do
 *     optical), elementos primeiro; cada LineString vira UM cabo sem produto
 *     (product_id null = badge "sem modelo", 1 fibra placeholder — §14.9) com
 *     segmento único entre os elementos ≤ 25 m das pontas (senão cria POLE).
 *   - export: KML 2.2 com um Folder por pasta e `netx-type` em ExtendedData
 *     (round-trip fiel); JSON {fileName, kml} — o client baixa via Blob.
 */
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import JSZip from 'jszip';
import type {
  ConfirmFibermapKmlImportRequest,
  FibermapKmlExportQuery,
  FibermapKmlExportResponse,
  FibermapKmlImportCablePreview,
  FibermapKmlImportElementPreview,
  FibermapKmlImportPreview,
  FibermapKmlImportResult,
} from '@netx/shared';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  buildFibermapKml,
  inferFibermapElementType,
  kmlDistanceMeters,
  kmlPathLengthMeters,
  parseFibermapKml,
  type KmlExportFolder,
} from './kml-io';

/** Raio de snap das pontas do cabo em elementos existentes (spec §12). */
const SNAP_RADIUS_M = 25;

interface LatLng {
  latitude: number;
  longitude: number;
}

function importErrMsg(err: unknown): string {
  const code = (err as { code?: string } | null)?.code;
  if (code === 'P2002') return 'nome já existe na pasta';
  if (code === 'P2000') return 'valor longo demais pra um campo';
  return err instanceof Error ? err.message : 'erro';
}

@Injectable()
export class FibermapKmlService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ───────────────────────────────────────────────────────────────────────
  // EXPORT
  // ───────────────────────────────────────────────────────────────────────
  async exportKml(
    tenantId: string,
    q: FibermapKmlExportQuery,
  ): Promise<FibermapKmlExportResponse> {
    const folders = await this.prisma.fibermapFolder.findMany({
      where: {
        tenantId,
        deletedAt: null,
        ...(q.folderId ? { id: q.folderId } : {}),
      },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    if (folders.length === 0) {
      throw new NotFoundException(
        q.folderId ? 'Pasta não encontrada' : 'Nenhuma pasta pra exportar',
      );
    }
    const folderIds = folders.map((f) => f.id);
    const [elements, cables] = await Promise.all([
      this.prisma.fibermapElement.findMany({
        where: { tenantId, deletedAt: null, folderId: { in: folderIds } },
        select: {
          folderId: true,
          name: true,
          type: true,
          latitude: true,
          longitude: true,
          description: true,
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.fibermapCable.findMany({
        where: { tenantId, deletedAt: null, folderId: { in: folderIds } },
        select: {
          folderId: true,
          name: true,
          displayColor: true,
          segments: { orderBy: { seq: 'asc' }, select: { seq: true, path: true } },
        },
        orderBy: { name: 'asc' },
      }),
    ]);

    const byFolder = new Map<string, KmlExportFolder>(
      folders.map((f) => [f.id, { name: f.name, elements: [], cables: [] }]),
    );
    for (const el of elements) {
      byFolder.get(el.folderId)?.elements.push({
        name: el.name,
        type: el.type,
        latitude: Number(el.latitude),
        longitude: Number(el.longitude),
        description: el.description,
      });
    }
    for (const c of cables) {
      byFolder.get(c.folderId)?.cables.push({
        name: c.name,
        displayColor: c.displayColor,
        segments: c.segments.map((s) => ({
          seq: s.seq,
          path: (Array.isArray(s.path) ? s.path : []) as number[][],
        })),
      });
    }

    const kml = buildFibermapKml([...byFolder.values()], 'NetX — FiberMap');
    const slug =
      folders.length === 1
        ? `-${folders[0].name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`
        : '';
    return {
      fileName: `netx-fibermap${slug}.kml`,
      kml,
      elements: elements.length,
      cables: cables.length,
    };
  }

  // ───────────────────────────────────────────────────────────────────────
  // IMPORT — preview
  // ───────────────────────────────────────────────────────────────────────
  async parsePreview(
    tenantId: string,
    folderId: string,
    buffer: Buffer,
  ): Promise<FibermapKmlImportPreview> {
    const folder = await this.prisma.fibermapFolder.findFirst({
      where: { id: folderId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!folder) throw new BadRequestException('Pasta destino inválida');

    const xml = await this.extractKmlXml(buffer);
    const parsed = parseFibermapKml(xml);

    const existing = await this.prisma.fibermapElement.findMany({
      where: { tenantId, folderId, deletedAt: null },
      select: { name: true },
    });
    const taken = new Set(existing.map((e) => e.name));
    const seenInFile = new Set<string>();

    const elements: FibermapKmlImportElementPreview[] = parsed.points.map((p) => {
      const name = p.name.slice(0, 160);
      let status: 'CREATE' | 'SKIP' = 'CREATE';
      let reason: string | null = null;
      if (taken.has(name)) {
        status = 'SKIP';
        reason = 'nome já existe na pasta destino';
      } else if (seenInFile.has(name)) {
        status = 'SKIP';
        reason = 'nome duplicado no arquivo';
      }
      seenInFile.add(name);
      return {
        name,
        type: inferFibermapElementType(name, p.typeHint),
        latitude: p.latitude,
        longitude: p.longitude,
        description: p.description,
        status,
        reason,
      };
    });

    // Pontas: melhor esforço — ponto do PRÓPRIO arquivo (a criar) ou elemento
    // existente ≤ 25 m; null = poste novo. O commit re-resolve com autoridade.
    const creatable = elements.filter((e) => e.status === 'CREATE');
    const resolveLabel = async (pt: LatLng): Promise<string | null> => {
      let best: { name: string; d: number } | null = null;
      for (const e of creatable) {
        const d = kmlDistanceMeters(pt, e);
        if (d <= SNAP_RADIUS_M && (!best || d < best.d)) best = { name: e.name, d };
      }
      if (best) return best.name;
      const hit = await this.nearestElement(tenantId, pt);
      return hit?.name ?? null;
    };

    const cables: FibermapKmlImportCablePreview[] = [];
    for (const line of parsed.lines) {
      const fromElementName = await resolveLabel(line.path[0]);
      const toElementName = await resolveLabel(line.path[line.path.length - 1]);
      const samePoint =
        fromElementName !== null && fromElementName === toElementName;
      cables.push({
        name: line.name.slice(0, 160),
        vertices: line.path.length,
        lengthMeters: kmlPathLengthMeters(line.path),
        description: line.description,
        fromElementName,
        toElementName,
        status: samePoint ? 'SKIP' : 'CREATE',
        reason: samePoint
          ? 'as duas pontas caem no mesmo elemento (rota menor que o raio de snap?)'
          : null,
        path: line.path,
      });
    }

    return { folderId, elements, cables, warnings: parsed.warnings };
  }

  private async extractKmlXml(buffer: Buffer): Promise<string> {
    const isZip =
      buffer.length >= 4 &&
      buffer[0] === 0x50 &&
      buffer[1] === 0x4b &&
      buffer[2] === 0x03 &&
      buffer[3] === 0x04;
    if (!isZip) return buffer.toString('utf-8');
    const zip = await JSZip.loadAsync(buffer);
    const docKml =
      zip.file('doc.kml') ??
      Object.values(zip.files).find(
        (f) => !f.dir && f.name.toLowerCase().endsWith('.kml'),
      );
    if (!docKml) throw new BadRequestException('KMZ não contém arquivo .kml');
    return docKml.async('string');
  }

  private async nearestElement(
    tenantId: string,
    pt: LatLng,
  ): Promise<{ id: string; name: string; latitude: number; longitude: number } | null> {
    const rows = await this.prisma.$queryRaw<
      Array<{ id: string; name: string; latitude: number; longitude: number }>
    >`
      SELECT id, name, latitude::float8 AS latitude, longitude::float8 AS longitude
        FROM fibermap_elements
       WHERE tenant_id = ${tenantId}::uuid
         AND deleted_at IS NULL
         AND geom IS NOT NULL
         AND ST_DWithin(geom::geography,
                        ST_SetSRID(ST_MakePoint(${pt.longitude}, ${pt.latitude}), 4326)::geography,
                        ${SNAP_RADIUS_M})
       ORDER BY ST_Distance(geom::geography,
                            ST_SetSRID(ST_MakePoint(${pt.longitude}, ${pt.latitude}), 4326)::geography)
       LIMIT 1`;
    return rows[0] ?? null;
  }

  // ───────────────────────────────────────────────────────────────────────
  // IMPORT — commit
  // ───────────────────────────────────────────────────────────────────────
  async commitImport(
    tenantId: string,
    actorUserId: string,
    input: ConfirmFibermapKmlImportRequest,
  ): Promise<FibermapKmlImportResult> {
    const folder = await this.prisma.fibermapFolder.findFirst({
      where: { id: input.folderId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!folder) throw new BadRequestException('Pasta destino inválida');

    const skipped: FibermapKmlImportResult['skipped'] = [];
    let elementsCreated = 0;
    let polesCreated = 0;
    let cablesCreated = 0;

    // Elementos primeiro (os cabos snapam neles). Transação POR ITEM: um nome
    // duplicado não pode abortar o lote inteiro (lição do optical).
    for (const e of input.elements) {
      try {
        await this.prisma.fibermapElement.create({
          data: {
            tenantId,
            folderId: input.folderId,
            type: e.type,
            name: e.name.slice(0, 160),
            latitude: new Prisma.Decimal(e.latitude),
            longitude: new Prisma.Decimal(e.longitude),
            description: e.description ?? null,
            metadata: { imported_from: 'kml' } as Prisma.InputJsonValue,
            createdById: actorUserId,
          },
          select: { id: true },
        });
        elementsCreated++;
      } catch (err) {
        skipped.push({ item: `Elemento "${e.name}"`, reason: importErrMsg(err) });
      }
    }

    // Nome dos POLEs automáticos: continua a numeração da pasta.
    let poleSeq =
      (await this.prisma.fibermapElement.count({
        where: { tenantId, folderId: input.folderId, name: { startsWith: 'POSTE-KML-' } },
      })) + 1;

    /** Elemento ≤ 25 m da ponta, senão POLE novo NA ponta. */
    const resolveEndpoint = async (
      pt: LatLng,
    ): Promise<{ id: string; coord: LatLng }> => {
      const hit = await this.nearestElement(tenantId, pt);
      if (hit) {
        return {
          id: hit.id,
          coord: { latitude: hit.latitude, longitude: hit.longitude },
        };
      }
      // Poste automático — colisão de nome tenta o próximo número (raro).
      for (let attempt = 0; attempt < 50; attempt++) {
        try {
          const pole = await this.prisma.fibermapElement.create({
            data: {
              tenantId,
              folderId: input.folderId,
              type: 'POLE',
              name: `POSTE-KML-${poleSeq++}`,
              latitude: new Prisma.Decimal(pt.latitude),
              longitude: new Prisma.Decimal(pt.longitude),
              metadata: { imported_from: 'kml', auto_pole: true } as Prisma.InputJsonValue,
              createdById: actorUserId,
            },
            select: { id: true },
          });
          polesCreated++;
          return { id: pole.id, coord: pt };
        } catch (err) {
          if ((err as { code?: string }).code !== 'P2002') throw err;
        }
      }
      throw new Error('não consegui gerar nome de poste livre');
    };

    for (const c of input.cables) {
      try {
        const from = await resolveEndpoint(c.path[0]);
        const to = await resolveEndpoint(c.path[c.path.length - 1]);
        if (from.id === to.id) {
          skipped.push({
            item: `Cabo "${c.name}"`,
            reason: 'as duas pontas caem no mesmo elemento',
          });
          continue;
        }
        // Pontas do path forçadas nas coords dos elementos (mesma regra do
        // desenho manual — conexão visual + comprimento correto).
        const path = [...c.path];
        path[0] = from.coord;
        path[path.length - 1] = to.coord;

        await this.prisma.$transaction(async (tx) => {
          // Cabo SEM produto (badge "sem modelo", §14.9) com 1 fibra
          // placeholder — associação de modelo re-instancia depois.
          const cable = await tx.fibermapCable.create({
            data: {
              tenantId,
              folderId: input.folderId,
              name: c.name.slice(0, 160),
              productId: null,
              fiberCount: 1,
              tubeCount: 1,
              fibersPerTube: 1,
              colorStandard: 'ABNT',
              excessFactor: new Prisma.Decimal('1.0200'),
              displayColor: null,
              notes: c.description ?? null,
              createdById: actorUserId,
            },
            select: { id: true },
          });
          await tx.fibermapCableTube.create({
            data: { cableId: cable.id, tubeNumber: 1, color: 'VERDE' },
          });
          await tx.fibermapFiber.create({
            data: {
              tenantId,
              cableId: cable.id,
              tubeNumber: 1,
              fiberNumber: 1,
              color: 'VERDE',
            },
          });
          await tx.fibermapCableSegment.create({
            data: {
              tenantId,
              cableId: cable.id,
              seq: 1,
              fromElementId: from.id,
              toElementId: to.id,
              path: path.map((p) => [p.longitude, p.latitude]) as Prisma.InputJsonValue,
            },
          });
        });
        cablesCreated++;
      } catch (err) {
        skipped.push({ item: `Cabo "${c.name}"`, reason: importErrMsg(err) });
      }
    }

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'fibermap.kml.imported',
      resource: 'fibermap_folders',
      resourceId: input.folderId,
      afterState: { elementsCreated, polesCreated, cablesCreated, skipped: skipped.length },
    });

    return { elementsCreated, polesCreated, cablesCreated, skipped };
  }
}
