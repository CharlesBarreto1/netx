/**
 * PowerBudgetService — cálculo de potência óptica OLT→ONT (R5 OSP).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Doc: docs/architecture/osp-network.md
 *
 * Função matemática pura — sem Prisma, sem side effects. Recebe parâmetros,
 * devolve breakdown. Permite reusar a lógica em outros contextos sem
 * acoplar a HTTP (ex: import de calculadora no app mobile no futuro).
 *
 * v1 = calculadora manual. v2 = traversal automático do grafo
 * (contrato→porta→cabo→splice→cabo→…→OLT) somando comprimentos+lossDb
 * de cada FiberSplice. Bloqueio v2: falta vínculo OpticalPort↔cabo-drop.
 */
import { Injectable } from '@nestjs/common';
import {
  DEFAULT_POWER_BUDGET_COEFFICIENTS,
  SPLITTER_LOSS_DB,
  type CalculatePowerBudgetRequest,
  type PowerBudgetBreakdownItem,
  type PowerBudgetResult,
} from '@netx/shared';

@Injectable()
export class PowerBudgetService {
  calculate(input: CalculatePowerBudgetRequest): PowerBudgetResult {
    const breakdown: PowerBudgetBreakdownItem[] = [];

    // 1) Fibra: km × dB/km na λ informada.
    const km = input.fiberLengthMeters / 1000;
    const attenPerKm =
      DEFAULT_POWER_BUDGET_COEFFICIENTS.fiberAttenDbPerKm[input.wavelengthNm];
    const fiberLoss = km * attenPerKm;
    if (km > 0) {
      breakdown.push({
        label: `Fibra @ ${input.wavelengthNm} nm`,
        lossDb: round2(fiberLoss),
        detail: `${attenPerKm} dB/km × ${km.toFixed(3)} km`,
      });
    }

    // 2) Splitters — soma loss de cada nível de cascata.
    for (const ratio of input.splitterRatios) {
      const loss = SPLITTER_LOSS_DB[ratio];
      breakdown.push({
        label: `Splitter 1:${splitterOutputCount(ratio)}`,
        lossDb: round2(loss),
      });
    }

    // 3) Fusões — uniforme. v2 usaria valores específicos do FiberSplice.
    if (input.spliceCount > 0) {
      const total = input.spliceCount * input.spliceLossDbPerSplice;
      breakdown.push({
        label: `Fusões`,
        lossDb: round2(total),
        detail: `${input.spliceCount} × ${input.spliceLossDbPerSplice.toFixed(2)} dB`,
      });
    }

    // 4) Conectores.
    if (input.connectorCount > 0) {
      const total = input.connectorCount * input.connectorLossDb;
      breakdown.push({
        label: 'Conectores',
        lossDb: round2(total),
        detail: `${input.connectorCount} × ${input.connectorLossDb.toFixed(2)} dB`,
      });
    }

    const totalLossDb = round2(
      breakdown.reduce((acc, item) => acc + item.lossDb, 0),
    );
    const predictedOntRxDbm = round2(input.oltTxDbm - totalLossDb);
    const totalBudgetDb = round2(input.oltTxDbm - input.ontRxMinDbm);
    const marginDb = round2(totalBudgetDb - totalLossDb);

    const status: PowerBudgetResult['status'] =
      marginDb < 0
        ? 'fail'
        : marginDb < DEFAULT_POWER_BUDGET_COEFFICIENTS.recommendedMarginDb
          ? 'tight'
          : 'safe';

    const result: PowerBudgetResult = {
      breakdown,
      totalLossDb,
      predictedOntRxDbm,
      totalBudgetDb,
      marginDb,
      status,
    };

    if (input.measuredOntRxDbm != null) {
      const diff = round2(input.measuredOntRxDbm - predictedOntRxDbm);
      result.measurement = {
        measuredOntRxDbm: input.measuredOntRxDbm,
        diffDb: diff,
        diffClass:
          Math.abs(diff) <= 1 ? 'matches' : diff > 0 ? 'better' : 'degraded',
      };
    }

    return result;
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function splitterOutputCount(ratio: keyof typeof SPLITTER_LOSS_DB): number {
  const map: Record<typeof ratio, number> = {
    ONE_TO_2: 2,
    ONE_TO_4: 4,
    ONE_TO_8: 8,
    ONE_TO_16: 16,
    ONE_TO_32: 32,
    ONE_TO_64: 64,
  };
  return map[ratio];
}
