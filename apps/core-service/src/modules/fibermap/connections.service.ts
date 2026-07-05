/**
 * FibermapConnectionsService — fusões/conectores, cortes e devices (FM-3).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Regras (spec §14):
 *   1. Fusão só entre pontas LIVRES e NO MESMO elemento — o pré-check dá o
 *      erro amigável; a garantia real sob concorrência é o UNIQUE de
 *      fibermap_connection_endpoints (P2002 ⇒ 409).
 *   2. Corte só onde o cabo PASSA (junção de segmentos); desfazer corte só
 *      com as duas pontas livres (FK Restrict cobre, pré-check melhora o erro).
 *   3. Desfazer fusão = hard-delete dos endpoints + soft-delete da conexão.
 *   4. Splitter desbalanceado exige tap_percent (§14.5).
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  fibermapCutEndKey,
  fibermapFiberEndKey,
  fibermapPortKey,
  type BulkFuseRequest,
  type BulkFuseResponse,
  type CreateFibermapConnectionRequest,
  type CreateFibermapCutRequest,
  type CreateFibermapDeviceRequest,
  type FibermapEndpointRef,
  type UpdateFibermapConnectionRequest,
  type UpdateFibermapDeviceRequest,
} from '@netx/shared';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

/** Colunas a_/b_ da conexão pra um endpoint polimórfico. */
interface EndpointCols {
  type: 'FIBER_END' | 'PORT';
  fiberId: string | null;
  fiberSide: 'A' | 'B' | 'U' | 'D' | null;
  cutId: string | null;
  portId: string | null;
  key: string;
}

@Injectable()
export class FibermapConnectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ───────────────────────────────────────────────────────────────────────
  // Conexões
  // ───────────────────────────────────────────────────────────────────────
  /**
   * Resolve e valida um endpoint no contexto (tenant, elemento): existência,
   * pertencimento ao elemento e retorna as colunas + endpoint_key.
   */
  private async resolveEndpoint(
    tenantId: string,
    elementId: string,
    ref: FibermapEndpointRef,
    kind: 'FUSION' | 'CONNECTOR',
  ): Promise<EndpointCols> {
    if (ref.type === 'PORT') {
      const port = await this.prisma.fibermapOpticalPort.findFirst({
        where: { id: ref.portId!, tenantId },
        select: { id: true, device: { select: { elementId: true, deletedAt: true } } },
      });
      if (!port || port.device.deletedAt) {
        throw new BadRequestException('Porta inválida');
      }
      if (port.device.elementId !== elementId) {
        throw new BadRequestException('Porta não pertence a este elemento (spec §14.1)');
      }
      return {
        type: 'PORT',
        fiberId: null,
        fiberSide: null,
        cutId: null,
        portId: port.id,
        // Face deriva do kind: fusão usa o pigtail traseiro, conector o frontal.
        key: fibermapPortKey(port.id, kind === 'FUSION' ? 'FUSION' : 'CONNECTOR'),
      };
    }

    const fiber = await this.prisma.fibermapFiber.findFirst({
      where: { id: ref.fiberId!, tenantId, cable: { deletedAt: null } },
      select: {
        id: true,
        cable: {
          select: {
            segments: {
              orderBy: { seq: 'asc' },
              select: { seq: true, fromElementId: true, toElementId: true },
            },
          },
        },
      },
    });
    if (!fiber) throw new BadRequestException('Fibra inválida');
    const segs = fiber.cable.segments;
    const first = segs[0];
    const last = segs[segs.length - 1];

    if (ref.side === 'U' || ref.side === 'D') {
      const cut = await this.prisma.fibermapFiberCut.findFirst({
        where: { id: ref.cutId!, tenantId, fiberId: fiber.id },
        select: { id: true, elementId: true },
      });
      if (!cut) throw new BadRequestException('Corte inválido pra esta fibra');
      if (cut.elementId !== elementId) {
        throw new BadRequestException('Corte não é deste elemento (spec §14.1)');
      }
      return {
        type: 'FIBER_END',
        fiberId: fiber.id,
        fiberSide: ref.side,
        cutId: cut.id,
        portId: null,
        key: fibermapCutEndKey(cut.id, ref.side),
      };
    }

    // Extremidade A/B: o cabo precisa começar/terminar NESTE elemento.
    const ok =
      ref.side === 'A'
        ? first?.fromElementId === elementId
        : last?.toElementId === elementId;
    if (!ok) {
      throw new BadRequestException(
        `A ponta ${ref.side} desta fibra não está neste elemento — o cabo ${ref.side === 'A' ? 'não começa' : 'não termina'} aqui`,
      );
    }
    return {
      type: 'FIBER_END',
      fiberId: fiber.id,
      fiberSide: ref.side!,
      cutId: null,
      portId: null,
      key: fibermapFiberEndKey(fiber.id, ref.side as 'A' | 'B'),
    };
  }

  async create(
    tenantId: string,
    actorUserId: string,
    input: CreateFibermapConnectionRequest,
  ): Promise<{ id: string }> {
    const element = await this.prisma.fibermapElement.findFirst({
      where: { id: input.elementId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!element) throw new BadRequestException('elementId inválido');

    const [a, b] = await Promise.all([
      this.resolveEndpoint(tenantId, input.elementId, input.a, input.kind),
      this.resolveEndpoint(tenantId, input.elementId, input.b, input.kind),
    ]);
    if (a.key === b.key) {
      throw new BadRequestException('Os dois lados são a mesma ponta');
    }

    // Pré-check amigável (o UNIQUE garante sob concorrência).
    const used = await this.prisma.fibermapConnectionEndpoint.findFirst({
      where: { endpointKey: { in: [a.key, b.key] } },
      select: { endpointKey: true },
    });
    if (used) {
      throw new ConflictException('Uma das pontas já está ocupada por outra conexão');
    }

    try {
      const created = await this.prisma.fibermapOpticalConnection.create({
        data: {
          tenantId,
          elementId: input.elementId,
          kind: input.kind,
          aType: a.type,
          aFiberId: a.fiberId,
          aFiberSide: a.fiberSide,
          aCutId: a.cutId,
          aPortId: a.portId,
          bType: b.type,
          bFiberId: b.fiberId,
          bFiberSide: b.fiberSide,
          bCutId: b.cutId,
          bPortId: b.portId,
          lossDb: input.lossDb == null ? null : new Prisma.Decimal(input.lossDb),
          notes: input.notes ?? null,
          createdById: actorUserId,
          endpoints: {
            create: [
              { tenantId, endpointKey: a.key },
              { tenantId, endpointKey: b.key },
            ],
          },
        },
        select: { id: true },
      });
      await this.audit.log({
        tenantId,
        userId: actorUserId,
        action: 'fibermap.connection.created',
        resource: 'fibermap_optical_connections',
        resourceId: created.id,
        afterState: { kind: input.kind, a: a.key, b: b.key, lossDb: input.lossDb ?? null },
      });
      return created;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Ponta ocupada por outra conexão (concorrência)');
      }
      throw err;
    }
  }

  async update(
    tenantId: string,
    actorUserId: string,
    id: string,
    input: UpdateFibermapConnectionRequest,
  ): Promise<void> {
    const existing = await this.prisma.fibermapOpticalConnection.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Conexão não encontrada');
    await this.prisma.fibermapOpticalConnection.update({
      where: { id },
      data: {
        lossDb:
          input.lossDb === undefined
            ? undefined
            : input.lossDb === null
              ? null
              : new Prisma.Decimal(input.lossDb),
        notes: input.notes === undefined ? undefined : input.notes ?? null,
        updatedById: actorUserId,
      },
    });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'fibermap.connection.updated',
      resource: 'fibermap_optical_connections',
      resourceId: id,
      afterState: { lossDb: input.lossDb },
    });
  }

  /** Desfazer: libera as pontas (hard-delete) e preserva histórico (soft). */
  async remove(tenantId: string, actorUserId: string, id: string): Promise<void> {
    const existing = await this.prisma.fibermapOpticalConnection.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true, kind: true },
    });
    if (!existing) throw new NotFoundException('Conexão não encontrada');
    await this.prisma.$transaction([
      this.prisma.fibermapConnectionEndpoint.deleteMany({
        where: { connectionId: id },
      }),
      this.prisma.fibermapOpticalConnection.update({
        where: { id },
        data: { deletedAt: new Date(), updatedById: actorUserId },
      }),
    ]);
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'fibermap.connection.deleted',
      resource: 'fibermap_optical_connections',
      resourceId: id,
      beforeState: { kind: existing.kind },
    });
  }

  /** Fusão em sequência (spec §8.1) — pares 1:1 a partir dos iniciais. */
  async bulkFuse(
    tenantId: string,
    actorUserId: string,
    input: BulkFuseRequest,
  ): Promise<BulkFuseResponse> {
    const skipped: BulkFuseResponse['skipped'] = [];
    let created = 0;
    for (let i = 0; i < input.count; i++) {
      const aFiberNumber = input.aStartFiber + i;
      const bFiberNumber = input.bStartFiber + i;
      const [aFiber, bFiber] = await Promise.all([
        this.prisma.fibermapFiber.findFirst({
          where: { tenantId, cableId: input.aCableId, fiberNumber: aFiberNumber },
          select: { id: true },
        }),
        this.prisma.fibermapFiber.findFirst({
          where: { tenantId, cableId: input.bCableId, fiberNumber: bFiberNumber },
          select: { id: true },
        }),
      ]);
      if (!aFiber || !bFiber) {
        skipped.push({ aFiber: aFiberNumber, bFiber: bFiberNumber, reason: 'fibra inexistente' });
        continue;
      }
      const [aRef, bRef] = await Promise.all([
        this.endpointAtElement(tenantId, input.elementId, aFiber.id),
        this.endpointAtElement(tenantId, input.elementId, bFiber.id),
      ]);
      if (!aRef || !bRef) {
        skipped.push({
          aFiber: aFiberNumber,
          bFiber: bFiberNumber,
          reason: 'sem ponta livre neste elemento',
        });
        continue;
      }
      try {
        await this.create(tenantId, actorUserId, {
          elementId: input.elementId,
          kind: 'FUSION',
          a: aRef,
          b: bRef,
          lossDb: null,
          notes: null,
        });
        created++;
      } catch (err) {
        skipped.push({
          aFiber: aFiberNumber,
          bFiber: bFiberNumber,
          reason:
            err instanceof ConflictException || err instanceof BadRequestException
              ? String((err.getResponse() as { message?: string }).message ?? 'conflito')
              : 'erro',
        });
      }
    }
    return { created, skipped };
  }

  /** Ponta LIVRE da fibra neste elemento (extremidade ou corte), se houver. */
  private async endpointAtElement(
    tenantId: string,
    elementId: string,
    fiberId: string,
  ): Promise<FibermapEndpointRef | null> {
    const fiber = await this.prisma.fibermapFiber.findFirst({
      where: { id: fiberId, tenantId },
      select: {
        id: true,
        cable: {
          select: {
            segments: {
              orderBy: { seq: 'asc' },
              select: { fromElementId: true, toElementId: true },
            },
          },
        },
        cuts: { where: { elementId }, select: { id: true } },
      },
    });
    if (!fiber) return null;
    const segs = fiber.cable.segments;
    const candidates: Array<{ ref: FibermapEndpointRef; key: string }> = [];
    if (segs[0]?.fromElementId === elementId) {
      candidates.push({
        ref: { type: 'FIBER_END', fiberId, side: 'A' },
        key: fibermapFiberEndKey(fiberId, 'A'),
      });
    }
    if (segs[segs.length - 1]?.toElementId === elementId) {
      candidates.push({
        ref: { type: 'FIBER_END', fiberId, side: 'B' },
        key: fibermapFiberEndKey(fiberId, 'B'),
      });
    }
    const cut = fiber.cuts[0];
    if (cut) {
      candidates.push(
        {
          ref: { type: 'FIBER_END', fiberId, side: 'U', cutId: cut.id },
          key: fibermapCutEndKey(cut.id, 'U'),
        },
        {
          ref: { type: 'FIBER_END', fiberId, side: 'D', cutId: cut.id },
          key: fibermapCutEndKey(cut.id, 'D'),
        },
      );
    }
    if (candidates.length === 0) return null;
    const used = await this.prisma.fibermapConnectionEndpoint.findMany({
      where: { endpointKey: { in: candidates.map((c) => c.key) } },
      select: { endpointKey: true },
    });
    const usedSet = new Set(used.map((u) => u.endpointKey));
    return candidates.find((c) => !usedSet.has(c.key))?.ref ?? null;
  }

  // ───────────────────────────────────────────────────────────────────────
  // Cortes (tesoura)
  // ───────────────────────────────────────────────────────────────────────
  async cut(
    tenantId: string,
    actorUserId: string,
    fiberId: string,
    input: CreateFibermapCutRequest,
  ): Promise<{ id: string }> {
    const fiber = await this.prisma.fibermapFiber.findFirst({
      where: { id: fiberId, tenantId, cable: { deletedAt: null } },
      select: {
        id: true,
        fiberNumber: true,
        cable: {
          select: {
            name: true,
            segments: {
              orderBy: { seq: 'asc' },
              select: { fromElementId: true, toElementId: true },
            },
          },
        },
      },
    });
    if (!fiber) throw new NotFoundException('Fibra não encontrada');
    // Corte só onde o cabo PASSA (junção entre 2 segmentos) — nas
    // extremidades a ponta já existe naturalmente.
    const segs = fiber.cable.segments;
    const passes = segs.some(
      (s, i) =>
        s.toElementId === input.elementId &&
        segs[i + 1]?.fromElementId === input.elementId,
    );
    if (!passes) {
      throw new BadRequestException(
        'O cabo não passa por dentro deste elemento — corte só em ponto de passagem',
      );
    }
    try {
      const created = await this.prisma.fibermapFiberCut.create({
        data: { tenantId, fiberId, elementId: input.elementId, createdById: actorUserId },
        select: { id: true },
      });
      await this.audit.log({
        tenantId,
        userId: actorUserId,
        action: 'fibermap.fiber.cut',
        resource: 'fibermap_fiber_cuts',
        resourceId: created.id,
        afterState: { cable: fiber.cable.name, fiber: fiber.fiberNumber, elementId: input.elementId },
      });
      return created;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Fibra já cortada neste elemento');
      }
      throw err;
    }
  }

  /** Desfaz o corte — só com as duas pontas livres (spec §6). */
  async removeCut(tenantId: string, actorUserId: string, cutId: string): Promise<void> {
    const cut = await this.prisma.fibermapFiberCut.findFirst({
      where: { id: cutId, tenantId },
      select: { id: true, fiberId: true, elementId: true },
    });
    if (!cut) throw new NotFoundException('Corte não encontrado');
    const used = await this.prisma.fibermapConnectionEndpoint.findFirst({
      where: {
        endpointKey: { in: [fibermapCutEndKey(cutId, 'U'), fibermapCutEndKey(cutId, 'D')] },
      },
      select: { id: true },
    });
    if (used) {
      throw new ConflictException('Desfaça as fusões das pontas do corte antes');
    }
    await this.prisma.fibermapFiberCut.delete({ where: { id: cutId } });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'fibermap.fiber.cut_undone',
      resource: 'fibermap_fiber_cuts',
      resourceId: cutId,
    });
  }

  // ───────────────────────────────────────────────────────────────────────
  // Devices (splitter/DIO/OLT no ponto de acesso)
  // ───────────────────────────────────────────────────────────────────────
  async createDevice(
    tenantId: string,
    actorUserId: string,
    elementId: string,
    input: CreateFibermapDeviceRequest,
  ): Promise<{ id: string }> {
    const element = await this.prisma.fibermapElement.findFirst({
      where: { id: elementId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!element) throw new BadRequestException('elementId inválido');

    if (input.productId) {
      const product = await this.prisma.fibermapProduct.findFirst({
        where: { id: input.productId, tenantId, deletedAt: null, isActive: true },
        select: { id: true },
      });
      if (!product) throw new BadRequestException('productId inválido/desativado');
    }

    const ports: Array<{ tenantId: string; role: 'IN' | 'OUT' | 'BIDI'; portNumber: number; label: string | null }> = [];
    let metadata: Record<string, unknown> = {};
    if (input.type === 'SPLITTER') {
      const outs = Number(input.ratio!.split('x')[1]);
      metadata = {
        ratio: input.ratio,
        topology: input.topology ?? 'BALANCED',
        ...(input.topology === 'UNBALANCED' ? { tap_percent: input.tapPercent } : {}),
      };
      ports.push({ tenantId, role: 'IN', portNumber: 1, label: 'IN' });
      for (let i = 1; i <= outs; i++) {
        ports.push({ tenantId, role: 'OUT', portNumber: i, label: `OUT ${i}` });
      }
    } else {
      const count = input.portsCount!;
      metadata = input.type === 'OLT' ? { pon_ports: count } : { ports: count };
      for (let i = 1; i <= count; i++) {
        ports.push({
          tenantId,
          role: 'BIDI',
          portNumber: i,
          label: input.type === 'OLT' ? `PON ${i}` : `Porta ${String(i).padStart(2, '0')}`,
        });
      }
    }

    const created = await this.prisma.fibermapDevice.create({
      data: {
        tenantId,
        elementId,
        type: input.type,
        name: input.name.trim(),
        productId: input.productId ?? null,
        metadata: metadata as Prisma.InputJsonValue,
        createdById: actorUserId,
        ports: { create: ports },
      },
      select: { id: true },
    });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'fibermap.device.created',
      resource: 'fibermap_devices',
      resourceId: created.id,
      afterState: { type: input.type, name: input.name, ports: ports.length },
    });
    return created;
  }

  async updateDevice(
    tenantId: string,
    actorUserId: string,
    id: string,
    input: UpdateFibermapDeviceRequest,
  ): Promise<void> {
    const existing = await this.prisma.fibermapDevice.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true, metadata: true },
    });
    if (!existing) throw new NotFoundException('Device não encontrado');
    const metadata =
      input.diagramPos === undefined
        ? undefined
        : ({
            ...((existing.metadata ?? {}) as Record<string, unknown>),
            diagram_pos: input.diagramPos,
          } as Prisma.InputJsonValue);
    await this.prisma.fibermapDevice.update({
      where: { id },
      data: { name: input.name?.trim(), metadata, updatedById: actorUserId },
    });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'fibermap.device.updated',
      resource: 'fibermap_devices',
      resourceId: id,
    });
  }

  /** Excluir device — só com todas as portas livres. */
  async removeDevice(tenantId: string, actorUserId: string, id: string): Promise<void> {
    const device = await this.prisma.fibermapDevice.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true, name: true, ports: { select: { id: true } } },
    });
    if (!device) throw new NotFoundException('Device não encontrado');
    const keys = device.ports.flatMap((p) => [
      fibermapPortKey(p.id, 'CONNECTOR'),
      fibermapPortKey(p.id, 'FUSION'),
    ]);
    const used = keys.length
      ? await this.prisma.fibermapConnectionEndpoint.findFirst({
          where: { endpointKey: { in: keys } },
          select: { id: true },
        })
      : null;
    if (used) {
      throw new ConflictException('Device com portas conectadas — desfaça as conexões antes');
    }
    await this.prisma.fibermapDevice.update({
      where: { id },
      data: { deletedAt: new Date(), updatedById: actorUserId },
    });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'fibermap.device.deleted',
      resource: 'fibermap_devices',
      resourceId: id,
      beforeState: { name: device.name },
    });
  }
}
