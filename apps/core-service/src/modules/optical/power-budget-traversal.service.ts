/**
 * PowerBudgetTraversalService — power budget AUTOMÁTICO (R8.3 OSP).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Doc: docs/architecture/osp-network.md
 *
 * Algoritmo:
 *   1. Carrega o grafo inteiro do tenant em batch (cabos + fusões + caixas
 *      + portas PON). O(N + E) memória; OK até dezenas de milhares de itens.
 *   2. A partir de (cableId, fiberIndex), traversa pra trás:
 *      a. Soma loss de fibra: dist × dB/km
 *      b. Procura PonPort com (cable, fiber) → encontrou OLT → para
 *      c. Senão, procura splice nas pontas A/B do cabo
 *      d. Salta pelo splice pro outro cabo+fibra, soma loss da fusão
 *      e. Repete até achar PonPort OU dar volta (cycle/unreachable)
 *   3. Splitters: detectados via OpticalEnclosure.splitterRatio nas pontas
 *      do cabo — soma loss do ratio.
 *
 * Saída: lista de hops + dB acumulado + dBm previsto no PONTO consultado.
 *
 * Limites: MAX_HOPS=64 (evita loop infinito em grafos patológicos).
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import {
  DEFAULT_POWER_BUDGET_COEFFICIENTS,
  SPLITTER_LOSS_DB,
  type PowerBudgetAtQuery,
  type PowerBudgetAtResult,
  type PowerBudgetHop,
} from '@netx/shared';

import { PrismaService } from '../prisma/prisma.service';
import { calculatePathLength } from './fiber-cables.service';

const MAX_HOPS = 64;

interface PathPoint {
  latitude: number;
  longitude: number;
}

function parsePath(json: unknown): PathPoint[] {
  if (!Array.isArray(json)) return [];
  return json
    .filter(
      (p): p is [number, number] =>
        Array.isArray(p) &&
        typeof p[0] === 'number' &&
        typeof p[1] === 'number',
    )
    .map(([lng, lat]) => ({ latitude: lat, longitude: lng }));
}

interface CableNode {
  id: string;
  code: string;
  fiberCount: number;
  lengthMeters: number;
  endpointAId: string | null;
  endpointBId: string | null;
}

interface SpliceLink {
  id: string;
  cableAId: string;
  fiberAIndex: number;
  cableBId: string;
  fiberBIndex: number;
  lossDb: number | null;
}

interface EnclosureNode {
  id: string;
  code: string;
  type: 'CTO' | 'NAP' | 'SPLITTER' | 'EMENDA' | 'RESERVA';
  splitterRatio: keyof typeof SPLITTER_LOSS_DB | null;
}

interface PonOrigin {
  oltId: string;
  oltName: string;
  ponIndex: number;
  txPowerDbm: number;
  cableId: string;
  fiberIndex: number;
}

@Injectable()
export class PowerBudgetTraversalService {
  constructor(private readonly prisma: PrismaService) {}

  async measureAt(
    tenantId: string,
    q: PowerBudgetAtQuery,
  ): Promise<PowerBudgetAtResult> {
    const cable = await this.prisma.fiberCable.findFirst({
      where: { id: q.cableId, tenantId, deletedAt: null },
      select: { id: true, fiberCount: true, lengthMeters: true },
    });
    if (!cable) throw new NotFoundException('Cabo não encontrado');
    if (q.fiberIndex > cable.fiberCount) {
      throw new NotFoundException(
        `Fibra ${q.fiberIndex} > capacidade do cabo (${cable.fiberCount})`,
      );
    }

    // Carrega o grafo inteiro em batch — evita N+1 no traversal.
    const [cables, splices, enclosures, ponPorts] = await Promise.all([
      this.prisma.fiberCable.findMany({
        where: { tenantId, deletedAt: null },
        select: {
          id: true,
          code: true,
          fiberCount: true,
          lengthMeters: true,
          endpointAId: true,
          endpointBId: true,
        },
      }),
      this.prisma.fiberSplice.findMany({
        where: { tenantId, deletedAt: null },
        select: {
          id: true,
          cableAId: true,
          fiberAIndex: true,
          cableBId: true,
          fiberBIndex: true,
          lossDb: true,
        },
      }),
      this.prisma.opticalEnclosure.findMany({
        where: { tenantId, deletedAt: null },
        select: {
          id: true,
          code: true,
          type: true,
          splitterRatio: true,
        },
      }),
      this.prisma.ponPort.findMany({
        where: { tenantId, cableId: { not: null }, fiberIndex: { not: null } },
        include: { olt: { select: { id: true, name: true } } },
      }),
    ]);

    // Maps de lookup O(1).
    const cablesById = new Map<string, CableNode>();
    for (const c of cables) {
      cablesById.set(c.id, {
        id: c.id,
        code: c.code,
        fiberCount: c.fiberCount,
        lengthMeters: Number(c.lengthMeters),
        endpointAId: c.endpointAId,
        endpointBId: c.endpointBId,
      });
    }
    const enclosuresById = new Map<string, EnclosureNode>();
    for (const e of enclosures) {
      enclosuresById.set(e.id, {
        id: e.id,
        code: e.code,
        type: e.type,
        splitterRatio: e.splitterRatio,
      });
    }
    // Splices indexados por (cableId, fiberIndex) — chave única graças aos
    // unique constraints do schema R4.
    const splicesByLeft = new Map<string, SpliceLink>();
    for (const s of splices) {
      const link: SpliceLink = {
        id: s.id,
        cableAId: s.cableAId,
        fiberAIndex: s.fiberAIndex,
        cableBId: s.cableBId,
        fiberBIndex: s.fiberBIndex,
        lossDb: s.lossDb != null ? Number(s.lossDb) : null,
      };
      splicesByLeft.set(`${s.cableAId}|${s.fiberAIndex}`, link);
      splicesByLeft.set(`${s.cableBId}|${s.fiberBIndex}`, link);
    }
    const pinByCableFiber = new Map<string, PonOrigin>();
    for (const p of ponPorts) {
      if (p.cableId && p.fiberIndex != null) {
        pinByCableFiber.set(`${p.cableId}|${p.fiberIndex}`, {
          oltId: p.oltId,
          oltName: p.olt.name,
          ponIndex: p.ponIndex,
          txPowerDbm:
            p.txPowerDbm != null
              ? Number(p.txPowerDbm)
              : DEFAULT_POWER_BUDGET_COEFFICIENTS.oltTxDbm,
          cableId: p.cableId,
          fiberIndex: p.fiberIndex,
        });
      }
    }

    // Cabos cuja ponta atua como splitter (passar por ela soma loss do ratio).
    function splitterLossAt(enclosureId: string | null): number {
      if (!enclosureId) return 0;
      const enc = enclosuresById.get(enclosureId);
      if (!enc || !enc.splitterRatio) return 0;
      return SPLITTER_LOSS_DB[enc.splitterRatio];
    }
    function splitterLabelAt(enclosureId: string | null): string | null {
      if (!enclosureId) return null;
      const enc = enclosuresById.get(enclosureId);
      if (!enc || !enc.splitterRatio) return null;
      return `Splitter ${enc.splitterRatio.replace('ONE_TO_', '1:')} (${enc.code})`;
    }

    const attenPerKm =
      DEFAULT_POWER_BUDGET_COEFFICIENTS.fiberAttenDbPerKm['1490']; // downstream
    const spliceDefault = DEFAULT_POWER_BUDGET_COEFFICIENTS.spliceLossDbDefault;
    const connectorLoss = DEFAULT_POWER_BUDGET_COEFFICIENTS.connectorLossDb;

    const path: PowerBudgetHop[] = [];

    // ── Trecho de fibra inicial: do ponto até a ponta MAIS PRÓXIMA da OLT.
    // Convenção: traversal vai sempre direção endpointA → endpointB → próximo
    // splice → próximo cabo. Mas a OLT pode estar em qualquer ponta. Tentamos
    // primeiro o endpointA (mais comum: cabo sai do POP no endpointA).
    //
    // distanceMeters opcional: quando informado, é a distância DESDE endpointA.
    // Loss do trecho parcial = dist × atten. Se ausente, considera o cabo todo.
    const startCable = cablesById.get(cable.id)!;
    const startFiber = q.fiberIndex;
    const distMeters =
      q.distanceMeters != null ? q.distanceMeters : startCable.lengthMeters;

    const visited = new Set<string>();
    const visitKey = (cableId: string, fiberIndex: number) =>
      `${cableId}|${fiberIndex}`;

    let resolved = false;
    let origin: PonOrigin | undefined;
    let unresolvedReason: string | undefined;

    function pushFiberHop(meters: number, cableCode: string) {
      const km = meters / 1000;
      const loss = km * attenPerKm;
      path.push({
        kind: 'fiber',
        label: `Fibra (${cableCode})`,
        lossDb: round2(loss),
        detail: `${attenPerKm} dB/km × ${km.toFixed(3)} km`,
      });
    }

    // 1) trecho parcial do ponto consultado até a ponta A
    pushFiberHop(distMeters, startCable.code);

    // 2) começa traversal a partir da ponta A do cabo
    let curCableId = startCable.id;
    let curFiberIndex = startFiber;
    let arrivedAtEndpoint: 'A' | 'B' = 'A'; // chegamos na ponta A (do ponto)

    for (let hop = 0; hop < MAX_HOPS; hop++) {
      visited.add(visitKey(curCableId, curFiberIndex));

      const cur = cablesById.get(curCableId);
      if (!cur) {
        unresolvedReason = 'Cabo desconhecido durante traversal';
        break;
      }

      // Verifica se ESTE par (cable, fiber) é a origem (PonPort).
      const pin = pinByCableFiber.get(visitKey(curCableId, curFiberIndex));
      if (pin) {
        // Origem encontrada! Adiciona connector da OLT.
        path.push({
          kind: 'connector',
          label: 'Conector OLT',
          lossDb: round2(connectorLoss),
        });
        path.push({
          kind: 'olt-tx',
          label: `OLT ${pin.oltName} · PON ${pin.ponIndex}`,
          lossDb: 0,
          detail: `TX ${pin.txPowerDbm.toFixed(1)} dBm`,
        });
        origin = pin;
        resolved = true;
        break;
      }

      // Não é origem — verifica splitter na ponta que estamos pesquisando.
      const endpointHere =
        arrivedAtEndpoint === 'A' ? cur.endpointAId : cur.endpointBId;
      const splitLoss = splitterLossAt(endpointHere);
      if (splitLoss > 0) {
        path.push({
          kind: 'splitter',
          label: splitterLabelAt(endpointHere) ?? 'Splitter',
          lossDb: round2(splitLoss),
        });
      }

      // Procura fusão envolvendo esta fibra.
      const splice = splicesByLeft.get(visitKey(curCableId, curFiberIndex));
      if (!splice) {
        unresolvedReason =
          'Fim do caminho — fibra não está fundida com nenhuma outra. ' +
          'Conecte a fibra à uma OLT (PonPort) ou crie a fusão pra continuar.';
        break;
      }

      // Loss da fusão (medido OR default).
      path.push({
        kind: 'splice',
        label: 'Fusão',
        lossDb: round2(splice.lossDb ?? spliceDefault),
      });

      // Salta pro OUTRO lado da fusão.
      const nextCableId =
        splice.cableAId === curCableId ? splice.cableBId : splice.cableAId;
      const nextFiberIndex =
        splice.cableAId === curCableId ? splice.fiberBIndex : splice.fiberAIndex;

      if (visited.has(visitKey(nextCableId, nextFiberIndex))) {
        unresolvedReason = 'Ciclo detectado no grafo de fusões';
        break;
      }

      // Comprimento do próximo cabo inteiro (entrada por uma ponta, sai pela
      // outra). Determinar arrivedAtEndpoint do PRÓXIMO cabo: o splice está
      // fisicamente na ponta de algum dos cabos. Heurística simples: se o
      // próximo cabo tem endpointAId == enclosure onde o splice está,
      // chegamos pela ponta A.
      const nextCable = cablesById.get(nextCableId);
      if (!nextCable) {
        unresolvedReason = 'Cabo desconhecido na fusão';
        break;
      }
      pushFiberHop(nextCable.lengthMeters, nextCable.code);

      // Inferência da próxima ponta: o splice acontece numa caixa que é
      // endpointA ou endpointB do cabo. Sem coord exata vou usar heurística:
      // se a caixa ATUAL (endpointHere) === endpointA do nextCable, entramos
      // pela A, traversamos rumo a B. Senão, entramos pela B.
      if (endpointHere && nextCable.endpointAId === endpointHere) {
        arrivedAtEndpoint = 'B'; // saímos pela B no próximo iteração
      } else if (endpointHere && nextCable.endpointBId === endpointHere) {
        arrivedAtEndpoint = 'A';
      } else {
        // Splice solto (sem caixa nas pontas) — assume A.
        arrivedAtEndpoint = 'A';
      }

      curCableId = nextCableId;
      curFiberIndex = nextFiberIndex;
    }

    if (!resolved && !unresolvedReason) {
      unresolvedReason = `Limite de ${MAX_HOPS} saltos excedido — grafo muito grande ou ciclo não detectado`;
    }

    const totalLossDb = round2(path.reduce((acc, h) => acc + h.lossDb, 0));
    const predictedDbm = origin
      ? round2(origin.txPowerDbm - totalLossDb)
      : null;

    return {
      resolved,
      unresolvedReason,
      path: path.reverse(), // reverte pra ficar OLT → ponto (leitura natural)
      totalLossDb,
      origin: origin
        ? {
            oltId: origin.oltId,
            oltName: origin.oltName,
            ponIndex: origin.ponIndex,
            txPowerDbm: origin.txPowerDbm,
          }
        : undefined,
      predictedDbm,
    };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
