/**
 * FibermapAccessPointService — read model do editor de emendas (FM-3, spec §8).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Semântica por fibra NESTE elemento (spec §4 — ponto crítico da sangria):
 *   - cabo TERMINA aqui (elemento é from do 1º segmento → lado A; to do
 *     último → lado B): a fibra tem 1 ponta (A ou B), livre ou conectada;
 *   - cabo PASSA por aqui (junção entre segmentos consecutivos): fibra sem
 *     corte = EXPRESSA (segue reta, pode cortar); com corte = 2 pontas U/D;
 *   - LOOP (começa E termina aqui): pontas A e B listadas juntas.
 *
 * Ocupação é resolvida via fibermap_connection_endpoints (a MESMA chave que
 * garante unicidade sob concorrência) — nunca por varredura das colunas a_/b_.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  FIBERMAP_ATTENUATION_DEFAULTS,
  fibermapCutEndKey,
  fibermapFiberEndKey,
  fibermapPortKey,
  type FibermapAccessPointResponse,
  type FibermapApCable,
  type FibermapApConnection,
  type FibermapApConnectionSide,
  type FibermapApFiber,
  type FibermapApFiberEnd,
} from '@netx/shared';

import { PrismaService } from '../prisma/prisma.service';

const CONN_INCLUDE = {
  aFiber: { select: { id: true, fiberNumber: true, color: true, cable: { select: { name: true } } } },
  bFiber: { select: { id: true, fiberNumber: true, color: true, cable: { select: { name: true } } } },
  aPort: { select: { id: true, label: true, portNumber: true, device: { select: { name: true } } } },
  bPort: { select: { id: true, label: true, portNumber: true, device: { select: { name: true } } } },
} satisfies Prisma.FibermapOpticalConnectionInclude;

type ConnRow = Prisma.FibermapOpticalConnectionGetPayload<{ include: typeof CONN_INCLUDE }>;

function connSide(
  c: ConnRow,
  which: 'a' | 'b',
): FibermapApConnectionSide {
  if (which === 'a' ? c.aType === 'PORT' : c.bType === 'PORT') {
    const port = which === 'a' ? c.aPort : c.bPort;
    return {
      type: 'PORT',
      portId: port?.id,
      deviceName: port?.device.name,
      portLabel: port?.label ?? `#${port?.portNumber ?? '?'}`,
    };
  }
  const fiber = which === 'a' ? c.aFiber : c.bFiber;
  const side = which === 'a' ? c.aFiberSide : c.bFiberSide;
  const cutId = which === 'a' ? c.aCutId : c.bCutId;
  return {
    type: 'FIBER_END',
    fiberId: fiber?.id,
    side: (side ?? 'A') as 'A' | 'B' | 'U' | 'D',
    cutId: cutId ?? undefined,
    cableName: fiber?.cable.name,
    fiberNumber: fiber?.fiberNumber,
    fiberColor: fiber?.color,
  };
}

@Injectable()
export class FibermapAccessPointService {
  constructor(private readonly prisma: PrismaService) {}

  async get(tenantId: string, elementId: string): Promise<FibermapAccessPointResponse> {
    const element = await this.prisma.fibermapElement.findFirst({
      where: { id: elementId, tenantId, deletedAt: null },
      select: { id: true, name: true, type: true },
    });
    if (!element) throw new NotFoundException('Elemento não encontrado');

    // ── Cabos incidentes: qualquer cabo com segmento tocando o elemento ────
    const segments = await this.prisma.fibermapCableSegment.findMany({
      where: {
        tenantId,
        OR: [{ fromElementId: elementId }, { toElementId: elementId }],
        cable: { deletedAt: null },
      },
      select: { cableId: true, seq: true, fromElementId: true, toElementId: true },
    });
    const cableIds = [...new Set(segments.map((s) => s.cableId))];

    const cables = cableIds.length
      ? await this.prisma.fibermapCable.findMany({
          where: { id: { in: cableIds } },
          include: {
            tubes: { orderBy: { tubeNumber: 'asc' } },
            fibers: { orderBy: { fiberNumber: 'asc' } },
            segments: {
              orderBy: { seq: 'asc' },
              select: { seq: true, fromElementId: true, toElementId: true },
            },
          },
          orderBy: { name: 'asc' },
        })
      : [];

    // ── Cortes deste elemento (fibra → corte) ──────────────────────────────
    const cuts = await this.prisma.fibermapFiberCut.findMany({
      where: { tenantId, elementId },
      select: { id: true, fiberId: true },
    });
    const cutByFiber = new Map(cuts.map((c) => [c.fiberId, c.id]));

    // ── Devices + portas ───────────────────────────────────────────────────
    const devices = await this.prisma.fibermapDevice.findMany({
      where: { tenantId, elementId, deletedAt: null },
      include: {
        ports: { orderBy: [{ role: 'asc' }, { portNumber: 'asc' }] },
      },
      orderBy: { name: 'asc' },
    });

    // ── Conexões vivas do elemento ─────────────────────────────────────────
    const connections = await this.prisma.fibermapOpticalConnection.findMany({
      where: { tenantId, elementId, deletedAt: null },
      include: CONN_INCLUDE,
      orderBy: { createdAt: 'asc' },
    });

    // ── Ocupação por endpoint_key (fonte de verdade da unicidade) ──────────
    const keys: string[] = [];
    for (const cable of cables) {
      for (const f of cable.fibers) {
        keys.push(fibermapFiberEndKey(f.id, 'A'), fibermapFiberEndKey(f.id, 'B'));
        const cutId = cutByFiber.get(f.id);
        if (cutId) keys.push(fibermapCutEndKey(cutId, 'U'), fibermapCutEndKey(cutId, 'D'));
      }
    }
    for (const d of devices) {
      for (const p of d.ports) {
        keys.push(fibermapPortKey(p.id, 'CONNECTOR'), fibermapPortKey(p.id, 'FUSION'));
      }
    }
    const endpointRows = keys.length
      ? await this.prisma.fibermapConnectionEndpoint.findMany({
          where: { endpointKey: { in: keys } },
          select: { endpointKey: true, connectionId: true },
        })
      : [];
    const usedBy = new Map(endpointRows.map((r) => [r.endpointKey, r.connectionId]));

    // ── Monta cabos com estado por fibra ───────────────────────────────────
    const apCables: FibermapApCable[] = cables.map((cable) => {
      const first = cable.segments[0];
      const last = cable.segments[cable.segments.length - 1];
      const startsHere = first?.fromElementId === elementId;
      const endsHere = last?.toElementId === elementId;
      const relation = startsHere && endsHere
        ? 'LOOP'
        : startsHere
          ? 'STARTS'
          : endsHere
            ? 'ENDS'
            : 'PASSES';

      const fibers: FibermapApFiber[] = cable.fibers.map((f) => {
        const ends: FibermapApFiberEnd[] = [];
        const pushEnd = (side: 'A' | 'B' | 'U' | 'D', cutId: string | null) => {
          const key = cutId
            ? fibermapCutEndKey(cutId, side as 'U' | 'D')
            : fibermapFiberEndKey(f.id, side as 'A' | 'B');
          const connectionId = usedBy.get(key) ?? null;
          ends.push({
            side,
            cutId,
            state: connectionId ? 'CONNECTED' : 'FREE',
            connectionId,
          });
        };

        if (relation === 'STARTS' || relation === 'LOOP') pushEnd('A', null);
        if (relation === 'ENDS' || relation === 'LOOP') pushEnd('B', null);
        if (relation === 'PASSES') {
          const cutId = cutByFiber.get(f.id);
          if (cutId) {
            pushEnd('U', cutId);
            pushEnd('D', cutId);
          }
        }

        const state: FibermapApFiber['state'] =
          ends.length === 0
            ? 'EXPRESS'
            : ends.some((e) => e.state === 'CONNECTED')
              ? 'CONNECTED'
              : 'FREE';
        return {
          id: f.id,
          fiberNumber: f.fiberNumber,
          tubeNumber: f.tubeNumber,
          color: f.color,
          status: f.status,
          state,
          ends,
        };
      });

      return {
        id: cable.id,
        name: cable.name,
        displayColor: cable.displayColor,
        fiberCount: cable.fiberCount,
        colorStandard: cable.colorStandard,
        relation,
        tubes: cable.tubes.map((t) => ({ tubeNumber: t.tubeNumber, color: t.color })),
        fibers,
      };
    });

    // ── Defaults de atenuação do tenant (badge quando lossDb é null) ───────
    const attn = await this.prisma.fibermapAttenuationDefault.findMany({
      where: { tenantId, itemKey: { in: ['FUSION', 'CONNECTOR_PAIR'] } },
    });
    const attnMap = new Map(attn.map((a) => [a.itemKey, Number(a.valueDb)]));

    return {
      element: { id: element.id, name: element.name, type: element.type },
      cables: apCables,
      devices: devices.map((d) => ({
        id: d.id,
        type: d.type,
        name: d.name,
        metadata: (d.metadata ?? {}) as Record<string, unknown>,
        ports: d.ports.map((p) => ({
          id: p.id,
          role: p.role,
          portNumber: p.portNumber,
          label: p.label,
          faces: {
            C: usedBy.get(fibermapPortKey(p.id, 'CONNECTOR')) ?? null,
            F: usedBy.get(fibermapPortKey(p.id, 'FUSION')) ?? null,
          },
        })),
      })),
      connections: connections.map(
        (c): FibermapApConnection => ({
          id: c.id,
          kind: c.kind,
          lossDb: c.lossDb ? Number(c.lossDb) : null,
          notes: c.notes,
          a: connSide(c, 'a'),
          b: connSide(c, 'b'),
        }),
      ),
      defaultFusionLossDb:
        attnMap.get('FUSION') ?? FIBERMAP_ATTENUATION_DEFAULTS.FUSION,
      defaultConnectorLossDb:
        attnMap.get('CONNECTOR_PAIR') ?? FIBERMAP_ATTENUATION_DEFAULTS.CONNECTOR_PAIR,
    };
  }
}
