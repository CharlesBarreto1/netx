/**
 * FiberMap — power budget (FM-6, spec §5.4). Módulo PURO.
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * O budget é o trace (FM-4) com outra saída: cada evento ganha o dBm
 * esperado no ponto (tx − perda acumulada) e um nível OK/WARN/CRIT pelos
 * limiares; as FOLHAS da árvore viram "terminais" — a linha por assinante/
 * ponta com distância, perda total e Rx esperado. A comparação esperado ×
 * medido (fibermap_power_measurements) é anexada pelo service (precisa do
 * banco); aqui só a matemática determinística, testada no jest.
 */
import type {
  FibermapPowerBudgetEvent,
  FibermapPowerBudgetLevel,
  FibermapPowerBudgetTerminal,
  FibermapTraceEvent,
} from '@netx/shared';

const round2 = (v: number): number => Math.round(v * 100) / 100;

export interface BudgetOptions {
  txDbm: number;
  /** WARN quando Rx esperado < warnDbm; CRIT quando < critDbm (spec §5.4). */
  warnDbm: number;
  critDbm: number;
}

export interface BudgetBuildResult {
  path: FibermapPowerBudgetEvent[];
  terminals: FibermapPowerBudgetTerminal[];
  worstDbm: number | null;
}

function levelOf(expectedDbm: number, opts: BudgetOptions): FibermapPowerBudgetLevel {
  if (expectedDbm < opts.critDbm) return 'CRIT';
  if (expectedDbm < opts.warnDbm) return 'WARN';
  return 'OK';
}

export function buildPowerBudget(
  trace: FibermapTraceEvent[],
  opts: BudgetOptions,
): BudgetBuildResult {
  const terminals: FibermapPowerBudgetTerminal[] = [];

  /** Contexto do trecho linear corrente — as folhas herdam os rótulos. */
  interface RunContext {
    branchPath: string | null;
    lastPort?: FibermapTraceEvent;
    lastFiber?: FibermapTraceEvent;
  }

  const enrich = (ev: FibermapTraceEvent): FibermapPowerBudgetEvent => {
    const expectedDbm = round2(opts.txDbm - ev.cumLossDb);
    const { branches: _branches, ...rest } = ev;
    return { ...rest, expectedDbm, level: levelOf(expectedDbm, opts) };
  };

  const walkList = (events: FibermapTraceEvent[], ctx: RunContext): FibermapPowerBudgetEvent[] => {
    const out: FibermapPowerBudgetEvent[] = [];
    for (const ev of events) {
      const enriched = enrich(ev);
      if (ev.kind === 'PORT') ctx.lastPort = ev;
      if (ev.kind === 'FIBER') ctx.lastFiber = ev;
      if (ev.kind === 'SPLITTER' && ev.branches && ev.branches.length > 0) {
        enriched.branches = ev.branches.map((b) => {
          const label = b.outPortLabel ?? `OUT ${b.outPortNumber}`;
          const branchCtx: RunContext = {
            branchPath: ctx.branchPath ? `${ctx.branchPath} › ${label}` : label,
          };
          return {
            outPortNumber: b.outPortNumber,
            outPortLabel: b.outPortLabel,
            events: walkList(b.events, branchCtx),
          };
        });
      }
      if (ev.kind === 'END') {
        terminals.push({
          branchPath: ctx.branchPath,
          elementId: ev.elementId,
          elementName: ev.elementName,
          deviceName: ctx.lastPort?.deviceName,
          portId: ctx.lastPort?.portId,
          portLabel: ctx.lastPort?.portLabel,
          cableName: ctx.lastFiber?.cableName,
          fiberNumber: ctx.lastFiber?.fiberNumber,
          endReason: ev.endReason,
          distanceM: ev.cumDistanceM,
          lossDb: ev.cumLossDb,
          expectedDbm: enriched.expectedDbm,
          level: enriched.level,
        });
      }
      out.push(enriched);
    }
    return out;
  };

  const path = walkList(trace, { branchPath: null });
  const worstDbm = terminals.length
    ? terminals.reduce((min, t) => Math.min(min, t.expectedDbm), Infinity)
    : null;
  return { path, terminals, worstDbm: worstDbm === null ? null : round2(worstDbm) };
}
