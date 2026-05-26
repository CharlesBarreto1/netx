/**
 * Cliente tipado pro cálculo de power budget (R5 OSP).
 * Backend: apps/core-service/src/modules/optical/power-budget.service.ts
 */
import { api } from './api';
import type { SplitterRatio } from './optical-api';

export type WavelengthNm = '1310' | '1490' | '1550';

export interface CalculatePowerBudgetInput {
  fiberLengthMeters: number;
  wavelengthNm?: WavelengthNm;
  splitterRatios?: SplitterRatio[];
  spliceCount?: number;
  spliceLossDbPerSplice?: number;
  connectorCount?: number;
  connectorLossDb?: number;
  oltTxDbm?: number;
  ontRxMinDbm?: number;
  measuredOntRxDbm?: number | null;
}

export interface PowerBudgetBreakdownItem {
  label: string;
  lossDb: number;
  detail?: string;
}

export interface PowerBudgetResult {
  breakdown: PowerBudgetBreakdownItem[];
  totalLossDb: number;
  predictedOntRxDbm: number;
  totalBudgetDb: number;
  marginDb: number;
  status: 'safe' | 'tight' | 'fail';
  measurement?: {
    measuredOntRxDbm: number;
    diffDb: number;
    diffClass: 'matches' | 'better' | 'degraded';
  };
}

export const powerBudgetApi = {
  calculate: (input: CalculatePowerBudgetInput) =>
    api.post<PowerBudgetResult>('/v1/optical/power-budget/calculate', input),
};
