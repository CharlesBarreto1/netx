/**
 * FiberMap — localizador OTDR (FM-5, spec §5.5). Módulo PURO.
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Converte a distância óptica medida no OTDR em campo na POSIÇÃO física do
 * evento: caminha o grafo de conectividade (trace-graph) a partir do elemento
 * de referência no sentido do elemento de direção, consumindo a sobra do
 * elemento de partida ANTES do comprimento de cada trecho (§5.5.3):
 *
 *   - distância cai dentro de uma sobra ⇒ o evento está fisicamente NA caixa
 *     (candidato IN_SLACK no elemento);
 *   - distância cai num segmento ⇒ fração geográfica = (restante ÷ excesso
 *     efetivo) ÷ comprimento geométrico, com a fração já convertida pra
 *     orientação ARMAZENADA da geometria quando o trecho é percorrido de
 *     to→from (o service usa ST_LineInterpolatePoint direto — equivale ao
 *     ST_Reverse da spec §5.5.4);
 *   - splitter antes da distância ⇒ um candidato por ramo + flag
 *     AMBIGUOUS_AFTER_SPLITTER (o OTDR não distingue ramos);
 *   - distância além da ponta documentada ⇒ BEYOND_END na ponta.
 *
 * A caminhada atravessa fusões/conectores (o OTDR não enxerga fronteira de
 * cabo) e, depois de localizar o evento, segue em modo "só eventos" até o fim
 * pra listar TODOS os expected_events do caminho (§5.5.7 — correlaciona a
 * curva inteira e detecta marco zero deslocado).
 *
 * Incerteza (§5.5.6, refinada): ±(Σ sobras atravessadas × 0,5 + metros
 * percorridos sobre comprimento GEOMÉTRICO × 0,01), mínimo ±10 m — só a
 * parcela sem measured_length_m contribui com o erro de excesso.
 */
import type { FibermapOtdrExpectedEvent, FibermapOtdrFlag } from '@netx/shared';

import {
  buildTraceGraph,
  cableElementChain,
  fiberPieces,
  TraceGraphError,
  type GraphEdge,
  type TraceCableData,
  type TraceGraphData,
  type TraceSegmentData,
} from './trace-graph';

const round2 = (v: number): number => Math.round(v * 100) / 100;
const EPS = 1e-9;

export interface OtdrLocateParams {
  cableId: string;
  fiberNumber: number;
  referenceElementId: string;
  directionElementId: string;
  distanceM: number;
}

export interface OtdrPureCandidate {
  kind: 'ON_SEGMENT' | 'IN_SLACK' | 'BEYOND_END';
  branchLabel: string | null;
  uncertaintyRadiusM: number;
  slackTraversedM: number;
  geometricBasedM: number;
  cable?: TraceCableData;
  // ON_SEGMENT:
  segment?: TraceSegmentData;
  walkFromElementId?: string;
  walkToElementId?: string;
  /** Offset ÓPTICO dentro do segmento, no sentido da caminhada. */
  offsetOpticalM?: number;
  /** Fração na geometria ARMAZENADA (já invertida quando reversed). */
  geoFractionStored?: number;
  reversed?: boolean;
  // IN_SLACK / BEYOND_END:
  elementId?: string;
}

export interface OtdrLocateResult {
  candidates: OtdrPureCandidate[];
  flags: FibermapOtdrFlag[];
  expectedEvents: FibermapOtdrExpectedEvent[];
}

export function locateOtdrEvent(
  data: TraceGraphData,
  params: OtdrLocateParams,
): OtdrLocateResult {
  const fiber = data.fibers.find(
    (f) => f.cableId === params.cableId && f.fiberNumber === params.fiberNumber,
  );
  if (!fiber) {
    throw new TraceGraphError('Fibra não encontrada no componente carregado');
  }
  const cable = data.cables.find((c) => c.id === params.cableId);
  if (!cable || cable.segments.length === 0) {
    throw new TraceGraphError('O cabo não tem segmentos desenhados');
  }
  const chain = cableElementChain(cable);
  const refIdx = chain.indexOf(params.referenceElementId);
  if (refIdx < 0) {
    throw new TraceGraphError('O elemento de referência não está na rota do cabo');
  }
  const dirIdx = chain.indexOf(params.directionElementId);
  if (dirIdx === refIdx) {
    throw new TraceGraphError('O elemento de direção não pode ser a própria referência');
  }

  const graph = buildTraceGraph(data);
  const pieces = fiberPieces(fiber, cable);
  const distance = params.distanceM;

  const flags = new Set<FibermapOtdrFlag>();
  const candidates: OtdrPureCandidate[] = [];
  const events: FibermapOtdrExpectedEvent[] = [];
  const visited = new Set<string>();

  const elName = (id: string | null | undefined): string | null =>
    (id && data.elements[id]?.name) || null;
  const pushEvent = (
    type: FibermapOtdrExpectedEvent['type'],
    elementId: string | null | undefined,
    cum: number,
    detail: string | null,
  ): void => {
    events.push({
      type,
      elementId: elementId ?? null,
      elementName: elName(elementId),
      expectedOtdrM: round2(cum),
      detail,
    });
  };

  const slackAt = (c: TraceCableData, elementId: string): number =>
    c.slacks
      .filter((s) => s.elementId === elementId)
      .reduce((a, s) => a + s.lengthM, 0);

  const uncertainty = (slackAcc: number, geoAcc: number): number =>
    Math.max(10, round2(slackAcc * 0.5 + geoAcc * 0.01));

  const other = (edge: GraphEdge, key: string): string =>
    edge.a === key ? edge.b : edge.a;

  /** Estado imutável por chamada — fan-out de splitter clona por ramo. */
  interface WalkState {
    cum: number;
    slackAcc: number;
    geoAcc: number;
    branch: string | null;
    /** true = evento já localizado; segue só coletando expected_events. */
    located: boolean;
  }

  function walkNode(
    nodeKey: string,
    cameEdgeId: string | null,
    s: WalkState,
    depth: number,
  ): void {
    if (depth > 10_000) {
      throw new TraceGraphError('Profundidade máxima excedida — laço na documentação?');
    }
    const node = graph.nodes.get(nodeKey);
    if (!node) return;
    const adj = graph.adj.get(nodeKey) ?? [];

    if (node.type === 'DEV') {
      const device = node.device!;
      const ratio = String(device.metadata?.ratio ?? '');
      pushEvent(
        'SPLITTER',
        device.elementId,
        s.cum,
        `${device.name}${ratio ? ` ${ratio}` : ''}${s.branch ? ` [${s.branch}]` : ''}`,
      );
      const cameEdge = adj.find((e) => e.id === cameEdgeId);
      if (cameEdge?.kind === 'SPL_OUT') {
        // Upstream: converge só pra IN.
        const inEdge = adj.find((e) => e.kind === 'SPL_IN' && !visited.has(e.id));
        if (!inEdge) {
          finishAtEnd(device.elementId, s);
          return;
        }
        visited.add(inEdge.id);
        walkNode(other(inEdge, nodeKey), inEdge.id, s, depth + 1);
        return;
      }
      // Downstream: o OTDR não distingue ramos — candidato por OUT (§5.5.5).
      const outs = adj
        .filter((e) => e.kind === 'SPL_OUT' && !visited.has(e.id))
        .sort((x, y) => x.outPort!.portNumber - y.outPort!.portNumber);
      if (outs.length === 0) {
        finishAtEnd(device.elementId, s);
        return;
      }
      if (outs.length > 1 && !s.located) flags.add('AMBIGUOUS_AFTER_SPLITTER');
      for (const e of outs) {
        visited.add(e.id);
        const label = e.outPort!.label ?? `OUT ${e.outPort!.portNumber}`;
        walkNode(
          other(e, nodeKey),
          e.id,
          { ...s, branch: s.branch ? `${s.branch} › ${label}` : label },
          depth + 1,
        );
      }
      return;
    }

    const conts = adj.filter((e) => e.id !== cameEdgeId && !visited.has(e.id));
    if (conts.length === 0) {
      pushEvent(
        'END',
        node.elementId,
        s.cum,
        node.type === 'PORT' ? (node.device?.name ?? null) : null,
      );
      finishAtEnd(node.elementId ?? null, s);
      return;
    }
    const edge = conts[0];
    visited.add(edge.id);
    if (edge.kind === 'CONN') {
      const conn = edge.conn!;
      pushEvent(
        conn.kind === 'CONNECTOR' ? 'CONNECTOR' : 'FUSION',
        conn.elementId,
        s.cum,
        s.branch ? `[${s.branch}]` : null,
      );
      walkNode(other(edge, nodeKey), edge.id, s, depth + 1);
      return;
    }
    if (edge.kind === 'FIBER') {
      const entryIdx = nodeKey === edge.a ? edge.aChainIdx! : edge.bChainIdx!;
      const exitIdx = nodeKey === edge.a ? edge.bChainIdx! : edge.aChainIdx!;
      walkEdge(edge.cable!, entryIdx, exitIdx, other(edge, nodeKey), edge.id, s, depth + 1);
      return;
    }
    // SPL_IN/SPL_OUT: cruza pro nó do device (eventos lá).
    walkNode(other(edge, nodeKey), edge.id, s, depth + 1);
  }

  /** Percorre a fibra trecho a trecho de fromIdx até toIdx (fronteira). */
  function walkEdge(
    cab: TraceCableData,
    fromIdx: number,
    toIdx: number,
    boundaryKey: string,
    edgeId: string,
    s: WalkState,
    depth: number,
  ): void {
    const ch = cableElementChain(cab);
    const dir: 1 | -1 = toIdx > fromIdx ? 1 : -1;
    let { cum, slackAcc, geoAcc, located } = s;
    let idx = fromIdx;
    while (idx !== toIdx) {
      const dep = ch[idx];
      const slack = slackAt(cab, dep);
      if (slack > 0) {
        if (!located && distance <= cum + slack + EPS) {
          // Evento dentro da sobra enrolada ⇒ fisicamente NA caixa (§5.5.3).
          flags.add('IN_SLACK');
          candidates.push({
            kind: 'IN_SLACK',
            branchLabel: s.branch,
            uncertaintyRadiusM: uncertainty(slackAcc + (distance - cum), geoAcc),
            slackTraversedM: round2(slackAcc + (distance - cum)),
            geometricBasedM: round2(geoAcc),
            cable: cab,
            elementId: dep,
          });
          located = true;
        }
        cum += slack;
        slackAcc += slack;
      }
      const segm = cab.segments[dir === 1 ? idx : idx - 1];
      const segOpt = segm.opticalLengthM;
      if (!located && distance <= cum + segOpt + EPS) {
        const remaining = distance - cum;
        const geomLen = segm.geometricLengthM > 0 ? segm.geometricLengthM : segOpt;
        // Excesso EFETIVO do segmento (ótico ÷ geométrico) — §5.5.4.
        const eff = geomLen > 0 && segOpt > 0 ? segOpt / geomLen : 1;
        const geoRemaining = remaining / eff;
        const fraction = Math.min(1, Math.max(0, geomLen > 0 ? geoRemaining / geomLen : 0));
        const reversed = dir === -1;
        const geoAccHere = geoAcc + (segm.measuredLengthM == null ? Math.max(0, remaining) : 0);
        candidates.push({
          kind: 'ON_SEGMENT',
          branchLabel: s.branch,
          uncertaintyRadiusM: uncertainty(slackAcc, geoAccHere),
          slackTraversedM: round2(slackAcc),
          geometricBasedM: round2(geoAccHere),
          cable: cab,
          segment: segm,
          walkFromElementId: ch[idx],
          walkToElementId: ch[idx + dir],
          offsetOpticalM: round2(remaining),
          geoFractionStored: reversed ? 1 - fraction : fraction,
          reversed,
        });
        located = true;
      }
      cum += segOpt;
      if (segm.measuredLengthM == null) geoAcc += segOpt;
      idx += dir;
    }
    walkNode(boundaryKey, edgeId, { ...s, cum, slackAcc, geoAcc, located }, depth + 1);
  }

  /** Fim da luz (ponta livre/porta terminal) sem ter localizado o evento. */
  function finishAtEnd(elementId: string | null, s: WalkState): void {
    if (s.located) return;
    flags.add('BEYOND_END');
    candidates.push({
      kind: 'BEYOND_END',
      branchLabel: s.branch,
      uncertaintyRadiusM: uncertainty(s.slackAcc, s.geoAcc),
      slackTraversedM: round2(s.slackAcc),
      geometricBasedM: round2(s.geoAcc),
      elementId: elementId ?? undefined,
    });
  }

  // ── Resolução do início (§5.5.1) ─────────────────────────────────────────
  const initial: WalkState = { cum: 0, slackAcc: 0, geoAcc: 0, branch: null, located: false };
  if (dirIdx >= 0) {
    // Direção ao longo do cabo: parte da posição do elemento de referência.
    const dir: 1 | -1 = dirIdx > refIdx ? 1 : -1;
    const piece = pieces.find((p) =>
      dir === 1
        ? p.loIdx <= refIdx && refIdx < p.hiIdx
        : p.loIdx < refIdx && refIdx <= p.hiIdx,
    );
    if (!piece) {
      throw new TraceGraphError('Sem fibra contínua nessa direção a partir da referência');
    }
    visited.add(piece.edgeId);
    const boundaryIdx = dir === 1 ? piece.hiIdx : piece.loIdx;
    const boundaryKey = dir === 1 ? piece.hiKey : piece.loKey;
    walkEdge(cable, refIdx, boundaryIdx, boundaryKey, piece.edgeId, initial, 0);
  } else {
    // Direção fora da rota: medição "pra trás", através da conexão da ponta.
    let startKey: string | null = null;
    let cameEdgeId: string | null = null;
    if (refIdx === 0) {
      startKey = pieces[0].loKey;
      cameEdgeId = pieces[0].edgeId;
    } else if (refIdx === chain.length - 1) {
      startKey = pieces[pieces.length - 1].hiKey;
      cameEdgeId = pieces[pieces.length - 1].edgeId;
    }
    if (!startKey || !cameEdgeId) {
      throw new TraceGraphError('O elemento de direção precisa estar na rota do cabo');
    }
    visited.add(cameEdgeId);
    walkNode(startKey, cameEdgeId, initial, 0);
  }

  events.sort((a, b) => a.expectedOtdrM - b.expectedOtdrM);
  return { candidates, flags: [...flags], expectedEvents: events };
}

// =============================================================================
// Calibração do fator de excesso (FM-6, spec §5.5.8)
// =============================================================================
const round4 = (v: number): number => Math.round(v * 10_000) / 10_000;

export interface ExcessCalibrationPair {
  /** Distância teórica do evento (expected_otdr_m do locate). */
  expectedM: number;
  /** Distância onde o evento apareceu na curva do OTDR. */
  measuredM: number;
}

export interface ExcessCalibrationFit {
  k: number;
  newExcessFactor: number;
  clamped: boolean;
}

/**
 * Mínimos quadrados PELA ORIGEM (marco zero compartilhado): k = Σ(m·e)/Σ(e²).
 * O novo excesso = excesso atual × k, aplicado NA INSTÂNCIA do cabo (§14.10).
 * Aproximação de primeira ordem: sobras não escalam com o excesso — com
 * medições boas o erro residual delas é pequeno frente ao ganho.
 * k fora de [0,8 · 1,25] indica marco zero deslocado ⇒ erro amigável.
 */
export function fitExcessFactor(
  currentExcessFactor: number,
  pairs: ExcessCalibrationPair[],
): ExcessCalibrationFit {
  if (pairs.length < 2) {
    throw new TraceGraphError('Calibração exige pelo menos 2 eventos identificados');
  }
  let num = 0;
  let den = 0;
  for (const p of pairs) {
    if (!(p.expectedM > 0) || !(p.measuredM > 0)) {
      throw new TraceGraphError('Distâncias da calibração devem ser positivas');
    }
    num += p.measuredM * p.expectedM;
    den += p.expectedM * p.expectedM;
  }
  const k = num / den;
  if (k < 0.8 || k > 1.25) {
    throw new TraceGraphError(
      'Medições incompatíveis com o documentado (fator fora de 0,8–1,25) — confira o marco zero e os eventos',
    );
  }
  const raw = currentExcessFactor * k;
  const clampedValue = Math.min(1.2, Math.max(0.9, raw));
  return {
    k: round4(k),
    newExcessFactor: round4(clampedValue),
    clamped: raw < 0.9 || raw > 1.2,
  };
}
