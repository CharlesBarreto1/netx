/**
 * FibermapReportsService — relatórios read-only (FM-6, spec §6 "Reports").
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 *   - cto-occupancy: portas OUT dos splitters por CTO; ocupação resolvida
 *     pelas chaves de fibermap_connection_endpoints (mesma fonte da
 *     unicidade) — porta com QUALQUER face ocupada conta como usada;
 *   - splice-book: caderno de emendas de um elemento (lados resolvidos);
 *   - cable-usage: fibras por status + comprimento óptico total (Σ
 *     coalesce(medido, geo×excesso) + sobras — regra §5.2).
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  fibermapPortKey,
  type FibermapCableUsageRow,
  type FibermapCtoOccupancyRow,
  type FibermapSpliceBookResponse,
  type ListFibermapReportQuery,
} from '@netx/shared';

import { PrismaService } from '../prisma/prisma.service';

const round1 = (v: number): number => Math.round(v * 10) / 10;

@Injectable()
export class FibermapReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async ctoOccupancy(
    tenantId: string,
    q: ListFibermapReportQuery,
  ): Promise<FibermapCtoOccupancyRow[]> {
    const ctos = await this.prisma.fibermapElement.findMany({
      where: {
        tenantId,
        type: 'CTO',
        deletedAt: null,
        ...(q.folderId ? { folderId: q.folderId } : {}),
      },
      select: {
        id: true,
        name: true,
        folderId: true,
        devices: {
          where: { type: 'SPLITTER', deletedAt: null },
          select: {
            id: true,
            ports: { where: { role: 'OUT' }, select: { id: true } },
          },
        },
      },
      orderBy: { name: 'asc' },
      take: 500,
    });

    const keys: string[] = [];
    for (const cto of ctos) {
      for (const d of cto.devices) {
        for (const p of d.ports) {
          keys.push(fibermapPortKey(p.id, 'CONNECTOR'), fibermapPortKey(p.id, 'FUSION'));
        }
      }
    }
    const used = keys.length
      ? await this.prisma.fibermapConnectionEndpoint.findMany({
          where: { endpointKey: { in: keys } },
          select: { endpointKey: true },
        })
      : [];
    // PORT:{id}:{C|F} → porta usada se qualquer face aparece.
    const usedPorts = new Set(used.map((u) => u.endpointKey.split(':')[1]));

    return ctos.map((cto) => {
      const ports = cto.devices.flatMap((d) => d.ports);
      const outPortsUsed = ports.filter((p) => usedPorts.has(p.id)).length;
      return {
        elementId: cto.id,
        name: cto.name,
        folderId: cto.folderId,
        splitters: cto.devices.length,
        outPortsTotal: ports.length,
        outPortsUsed,
        occupancyPct: ports.length ? round1((outPortsUsed / ports.length) * 100) : 0,
      };
    });
  }

  async spliceBook(
    tenantId: string,
    elementId: string,
  ): Promise<FibermapSpliceBookResponse> {
    const element = await this.prisma.fibermapElement.findFirst({
      where: { id: elementId, tenantId, deletedAt: null },
      select: { id: true, name: true, type: true },
    });
    if (!element) throw new NotFoundException('Elemento não encontrado');

    const connections = await this.prisma.fibermapOpticalConnection.findMany({
      where: { tenantId, elementId, deletedAt: null },
      include: {
        aFiber: { select: { fiberNumber: true, cable: { select: { name: true } } } },
        bFiber: { select: { fiberNumber: true, cable: { select: { name: true } } } },
        aPort: { select: { label: true, portNumber: true, device: { select: { name: true } } } },
        bPort: { select: { label: true, portNumber: true, device: { select: { name: true } } } },
      },
      orderBy: { createdAt: 'asc' },
    });

    type Row = (typeof connections)[number];
    const sideLabel = (c: Row, which: 'a' | 'b'): string => {
      const type = which === 'a' ? c.aType : c.bType;
      if (type === 'PORT') {
        const port = which === 'a' ? c.aPort : c.bPort;
        return `${port?.device.name ?? '?'} · ${port?.label ?? `#${port?.portNumber ?? '?'}`}`;
      }
      const fiber = which === 'a' ? c.aFiber : c.bFiber;
      const cutId = which === 'a' ? c.aCutId : c.bCutId;
      const side = which === 'a' ? c.aFiberSide : c.bFiberSide;
      const base = `${fiber?.cable.name ?? '?'} · f${fiber?.fiberNumber ?? '?'}`;
      return cutId ? `${base} (corte ${side ?? ''})` : base;
    };

    return {
      element,
      rows: connections.map((c) => ({
        connectionId: c.id,
        kind: c.kind,
        aLabel: sideLabel(c, 'a'),
        bLabel: sideLabel(c, 'b'),
        lossDb: c.lossDb == null ? null : Number(c.lossDb),
        notes: c.notes,
        createdAt: c.createdAt.toISOString(),
      })),
    };
  }

  async cableUsage(
    tenantId: string,
    q: ListFibermapReportQuery,
  ): Promise<FibermapCableUsageRow[]> {
    const cables = await this.prisma.fibermapCable.findMany({
      where: {
        tenantId,
        deletedAt: null,
        ...(q.folderId ? { folderId: q.folderId } : {}),
      },
      select: { id: true, name: true, folderId: true, fiberCount: true },
      orderBy: { name: 'asc' },
      take: 500,
    });
    if (cables.length === 0) return [];
    const cableIds = cables.map((c) => c.id);

    const [lengths, fibers] = await Promise.all([
      this.prisma.$queryRaw<Array<{ cable_id: string; total_m: number }>>`
        SELECT c.id AS cable_id,
               coalesce(seg.m, 0) + coalesce(sl.m, 0) AS total_m
          FROM fibermap_cables c
          LEFT JOIN (
            SELECT s.cable_id,
                   sum(coalesce(s.measured_length_m,
                                round(s.geometric_length_m * cc.excess_factor, 2)))::float8 AS m
              FROM fibermap_cable_segments s
              JOIN fibermap_cables cc ON cc.id = s.cable_id
             GROUP BY s.cable_id
          ) seg ON seg.cable_id = c.id
          LEFT JOIN (
            SELECT cable_id, sum(length_m)::float8 AS m
              FROM fibermap_cable_slacks
             GROUP BY cable_id
          ) sl ON sl.cable_id = c.id
         WHERE c.id IN (${Prisma.join(cableIds)})`,
      this.prisma.fibermapFiber.groupBy({
        by: ['cableId', 'status'],
        where: { cableId: { in: cableIds } },
        _count: true,
      }),
    ]);

    const lengthByCable = new Map(lengths.map((l) => [l.cable_id, Number(l.total_m)]));
    const counts = new Map<string, Record<string, number>>();
    for (const f of fibers) {
      const c = counts.get(f.cableId) ?? {};
      c[f.status] = f._count;
      counts.set(f.cableId, c);
    }

    return cables.map((c) => {
      const byStatus = counts.get(c.id) ?? {};
      const active = byStatus.ACTIVE ?? 0;
      const reserved = byStatus.RESERVED ?? 0;
      return {
        cableId: c.id,
        name: c.name,
        folderId: c.folderId,
        fiberCount: c.fiberCount,
        dark: byStatus.DARK ?? 0,
        active,
        reserved,
        broken: byStatus.BROKEN ?? 0,
        usedPct: c.fiberCount ? round1(((active + reserved) / c.fiberCount) * 100) : 0,
        totalOpticalM: Math.round((lengthByCable.get(c.id) ?? 0) * 100) / 100,
      };
    });
  }
}
