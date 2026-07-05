/**
 * FibermapConnectivityGraphService — carrega o componente conexo e traça (FM-4).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Spec §4: o grafo é montado POR DEMANDA a partir de um endpoint — nunca a
 * planta inteira. O carregamento é em ondas (BFS no banco): fibras novas
 * puxam cabo (segmentos+sobras) e cortes; portas novas puxam o device inteiro
 * (irmãs incluídas — splitter ramifica); as conexões dos nós novos descobrem
 * a próxima onda. A caminhada em si é pura (trace-graph.ts) — os testes
 * exercitam lá; aqui só resolvemos Prisma → dados e DTO de resposta.
 */
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  FibermapFiberTraceQuery,
  FibermapPortTraceQuery,
  FibermapTraceResponse,
  FibermapTraceWavelength,
} from '@netx/shared';

import { PrismaService } from '../prisma/prisma.service';
import { FibermapAttenuationService } from './attenuation.service';
import {
  TraceGraphError,
  walkTrace,
  type TraceCableData,
  type TraceConnEndpoint,
  type TraceConnectionData,
  type TraceDeviceData,
  type TraceFiberData,
  type TraceGraphData,
  type TraceOrigin,
} from './trace-graph';

/** Trava de segurança do componente conexo (spec §4: nunca a planta toda). */
const MAX_COMPONENT_NODES = 20_000;
const MAX_WAVES = 30;

const round2 = (v: number): number => Math.round(v * 100) / 100;

type ConnRow = Prisma.FibermapOpticalConnectionGetPayload<{
  select: {
    id: true;
    elementId: true;
    kind: true;
    lossDb: true;
    aType: true;
    aFiberId: true;
    aFiberSide: true;
    aCutId: true;
    aPortId: true;
    bType: true;
    bFiberId: true;
    bFiberSide: true;
    bCutId: true;
    bPortId: true;
  };
}>;

function connEndpoint(row: ConnRow, which: 'a' | 'b'): TraceConnEndpoint {
  const type = which === 'a' ? row.aType : row.bType;
  if (type === 'PORT') {
    return { type: 'PORT', portId: (which === 'a' ? row.aPortId : row.bPortId)! };
  }
  const cutId = which === 'a' ? row.aCutId : row.bCutId;
  const side = which === 'a' ? row.aFiberSide : row.bFiberSide;
  if (cutId) {
    return { type: 'CUT_END', cutId, side: side as 'U' | 'D' };
  }
  return {
    type: 'FIBER_END',
    fiberId: (which === 'a' ? row.aFiberId : row.bFiberId)!,
    side: side as 'A' | 'B',
  };
}

@Injectable()
export class FibermapConnectivityGraphService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly attenuation: FibermapAttenuationService,
  ) {}

  // ───────────────────────────────────────────────────────────────────────
  // Entrypoints dos endpoints de trace
  // ───────────────────────────────────────────────────────────────────────
  async traceFiber(
    tenantId: string,
    fiberId: string,
    q: FibermapFiberTraceQuery,
  ): Promise<FibermapTraceResponse> {
    const fiber = await this.prisma.fibermapFiber.findFirst({
      where: { id: fiberId, tenantId, cable: { deletedAt: null } },
      select: { id: true },
    });
    if (!fiber) throw new NotFoundException('Fibra não encontrada');

    let origin: TraceOrigin;
    if (q.cutId) {
      const cut = await this.prisma.fibermapFiberCut.findFirst({
        where: { id: q.cutId, tenantId, fiberId },
        select: { id: true },
      });
      if (!cut) throw new BadRequestException('Corte inválido pra esta fibra');
      origin = { kind: 'CUT_END', cutId: q.cutId, side: q.cutSide! };
    } else {
      origin = { kind: 'FIBER_END', fiberId, side: q.from ?? 'A' };
    }

    const data = await this.loadComponent(tenantId, [fiberId], []);
    return this.run(data, origin, q.wavelength as FibermapTraceWavelength);
  }

  async tracePort(
    tenantId: string,
    portId: string,
    q: FibermapPortTraceQuery,
  ): Promise<FibermapTraceResponse> {
    const port = await this.prisma.fibermapOpticalPort.findFirst({
      where: { id: portId, tenantId, device: { deletedAt: null } },
      select: { id: true },
    });
    if (!port) throw new NotFoundException('Porta não encontrada');

    const data = await this.loadComponent(tenantId, [], [portId]);
    return this.run(
      data,
      { kind: 'PORT', portId },
      q.wavelength as FibermapTraceWavelength,
    );
  }

  private run(
    data: TraceGraphData,
    origin: TraceOrigin,
    wavelengthNm: FibermapTraceWavelength,
  ): FibermapTraceResponse {
    try {
      const walk = walkTrace(data, origin, wavelengthNm);
      return {
        wavelengthNm,
        origin: {
          kind: origin.kind,
          ...(origin.kind === 'FIBER_END'
            ? { fiberId: origin.fiberId, side: origin.side }
            : origin.kind === 'CUT_END'
              ? { cutId: origin.cutId, side: origin.side }
              : { portId: origin.portId }),
        },
        path: walk.path,
        maxDistanceM: walk.maxDistanceM,
        maxLossDb: walk.maxLossDb,
        mapGeometry: {
          type: 'MultiLineString',
          coordinates: walk.traversedSegments.map((s) => s.path),
        },
      };
    } catch (err) {
      if (err instanceof TraceGraphError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // Carregamento do componente conexo (ondas)
  // ───────────────────────────────────────────────────────────────────────
  private async loadComponent(
    tenantId: string,
    seedFiberIds: string[],
    seedPortIds: string[],
  ): Promise<TraceGraphData> {
    const fibers = new Map<string, TraceFiberData>();
    const cables = new Map<string, TraceCableData>();
    const devices = new Map<string, TraceDeviceData>();
    const connections = new Map<string, TraceConnectionData>();
    const loadedPortIds = new Set<string>();

    let pendingFibers = new Set(seedFiberIds);
    let pendingPorts = new Set(seedPortIds);

    for (
      let wave = 0;
      wave < MAX_WAVES && (pendingFibers.size > 0 || pendingPorts.size > 0);
      wave++
    ) {
      const fiberIds = [...pendingFibers].filter((id) => !fibers.has(id));
      const portIds = [...pendingPorts].filter((id) => !loadedPortIds.has(id));
      pendingFibers = new Set();
      pendingPorts = new Set();

      // ── Fibras novas (+ cortes) e seus cabos ────────────────────────────
      const newFiberIds: string[] = [];
      if (fiberIds.length > 0) {
        const rows = await this.prisma.fibermapFiber.findMany({
          where: { id: { in: fiberIds }, tenantId, cable: { deletedAt: null } },
          select: {
            id: true,
            cableId: true,
            fiberNumber: true,
            tubeNumber: true,
            color: true,
            cuts: { select: { id: true, elementId: true } },
          },
        });
        for (const f of rows) {
          fibers.set(f.id, {
            id: f.id,
            cableId: f.cableId,
            fiberNumber: f.fiberNumber,
            tubeNumber: f.tubeNumber,
            color: f.color,
            cuts: f.cuts,
          });
          newFiberIds.push(f.id);
        }
        const newCableIds = [
          ...new Set(rows.map((f) => f.cableId)),
        ].filter((id) => !cables.has(id));
        if (newCableIds.length > 0) {
          const cableRows = await this.prisma.fibermapCable.findMany({
            where: { id: { in: newCableIds } },
            select: {
              id: true,
              name: true,
              excessFactor: true,
              segments: {
                orderBy: { seq: 'asc' },
                select: {
                  id: true,
                  seq: true,
                  fromElementId: true,
                  toElementId: true,
                  path: true,
                  geometricLengthM: true,
                  measuredLengthM: true,
                },
              },
              slacks: { select: { elementId: true, lengthM: true } },
            },
          });
          for (const c of cableRows) {
            const excess = Number(c.excessFactor);
            cables.set(c.id, {
              id: c.id,
              name: c.name,
              segments: c.segments.map((s) => ({
                id: s.id,
                seq: s.seq,
                fromElementId: s.fromElementId,
                toElementId: s.toElementId,
                opticalLengthM: s.measuredLengthM
                  ? Number(s.measuredLengthM)
                  : round2(Number(s.geometricLengthM) * excess),
                path: (Array.isArray(s.path) ? s.path : []) as number[][],
              })),
              slacks: c.slacks.map((s) => ({
                elementId: s.elementId,
                lengthM: Number(s.lengthM),
              })),
            });
          }
        }
      }

      // ── Portas novas → device inteiro (irmãs incluídas) ─────────────────
      const newPortIds: string[] = [];
      if (portIds.length > 0) {
        const portRows = await this.prisma.fibermapOpticalPort.findMany({
          where: { id: { in: portIds }, tenantId, device: { deletedAt: null } },
          select: { deviceId: true },
        });
        const newDeviceIds = [
          ...new Set(portRows.map((p) => p.deviceId)),
        ].filter((id) => !devices.has(id));
        if (newDeviceIds.length > 0) {
          const devRows = await this.prisma.fibermapDevice.findMany({
            where: { id: { in: newDeviceIds }, deletedAt: null },
            select: {
              id: true,
              elementId: true,
              type: true,
              name: true,
              metadata: true,
              ports: {
                orderBy: [{ role: 'asc' }, { portNumber: 'asc' }],
                select: { id: true, role: true, portNumber: true, label: true },
              },
            },
          });
          for (const d of devRows) {
            devices.set(d.id, {
              id: d.id,
              elementId: d.elementId,
              type: d.type,
              name: d.name,
              metadata: (d.metadata ?? {}) as Record<string, unknown>,
              ports: d.ports,
            });
            for (const p of d.ports) {
              loadedPortIds.add(p.id);
              newPortIds.push(p.id);
            }
          }
        }
        // Portas pedidas que não viraram device novo (device já carregado)
        // já estão em loadedPortIds — nada a fazer.
      }

      if (fibers.size + loadedPortIds.size > MAX_COMPONENT_NODES) {
        throw new BadRequestException(
          'Componente conexo grande demais pra trace — verifique laços na documentação da planta',
        );
      }

      // ── Conexões tocando os nós NOVOS desta onda ────────────────────────
      const or: Prisma.FibermapOpticalConnectionWhereInput[] = [];
      if (newFiberIds.length > 0) {
        or.push({ aFiberId: { in: newFiberIds } }, { bFiberId: { in: newFiberIds } });
      }
      if (newPortIds.length > 0) {
        or.push({ aPortId: { in: newPortIds } }, { bPortId: { in: newPortIds } });
      }
      if (or.length === 0) continue;

      const connRows = await this.prisma.fibermapOpticalConnection.findMany({
        where: { tenantId, deletedAt: null, OR: or },
        select: {
          id: true,
          elementId: true,
          kind: true,
          lossDb: true,
          aType: true,
          aFiberId: true,
          aFiberSide: true,
          aCutId: true,
          aPortId: true,
          bType: true,
          bFiberId: true,
          bFiberSide: true,
          bCutId: true,
          bPortId: true,
        },
      });
      for (const row of connRows) {
        if (connections.has(row.id)) continue;
        const a = connEndpoint(row, 'a');
        const b = connEndpoint(row, 'b');
        connections.set(row.id, {
          id: row.id,
          elementId: row.elementId,
          kind: row.kind,
          lossDb: row.lossDb == null ? null : Number(row.lossDb),
          a,
          b,
        });
        // Descoberta da próxima onda (corte carrega junto o fiberId).
        for (const fid of [row.aFiberId, row.bFiberId]) {
          if (fid && !fibers.has(fid)) pendingFibers.add(fid);
        }
        for (const pid of [row.aPortId, row.bPortId]) {
          if (pid && !loadedPortIds.has(pid)) pendingPorts.add(pid);
        }
      }
    }

    // ── Elementos referenciados (nome + coordenada pros eventos/mapa) ─────
    const elementIds = new Set<string>();
    for (const c of cables.values()) {
      for (const s of c.segments) {
        elementIds.add(s.fromElementId);
        elementIds.add(s.toElementId);
      }
    }
    for (const d of devices.values()) elementIds.add(d.elementId);
    for (const c of connections.values()) elementIds.add(c.elementId);
    for (const f of fibers.values()) {
      for (const cut of f.cuts) elementIds.add(cut.elementId);
    }
    const elementRows = elementIds.size
      ? await this.prisma.fibermapElement.findMany({
          where: { id: { in: [...elementIds] }, tenantId },
          select: { id: true, name: true, latitude: true, longitude: true },
        })
      : [];

    const { values: attenuation } = await this.attenuation.get(tenantId);

    return {
      fibers: [...fibers.values()],
      cables: [...cables.values()],
      devices: [...devices.values()],
      connections: [...connections.values()],
      elements: Object.fromEntries(
        elementRows.map((e) => [
          e.id,
          {
            name: e.name,
            latitude: Number(e.latitude),
            longitude: Number(e.longitude),
          },
        ]),
      ),
      attenuation,
    };
  }
}
