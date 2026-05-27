/**
 * Cliente tipado pras PON ports da OLT (R8.3 OSP).
 * Backend: apps/core-service/src/modules/optical/pon-ports.service.ts
 */
import { api } from './api';

export interface PonPort {
  id: string;
  tenantId: string;
  oltId: string;
  oltName: string;
  ponIndex: number;
  cableId: string | null;
  cable: { id: string; code: string; fiberCount: number } | null;
  fiberIndex: number | null;
  txPowerDbm: number | null;
  effectiveTxPowerDbm: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePonPortInput {
  oltId: string;
  ponIndex: number;
  cableId?: string | null;
  fiberIndex?: number | null;
  txPowerDbm?: number | null;
  notes?: string | null;
}

export type UpdatePonPortInput = Omit<
  Partial<CreatePonPortInput>,
  'oltId' | 'ponIndex'
>;

export const ponPortsApi = {
  listByOltPath: (oltId: string) => `/v1/optical/olts/${oltId}/pon-ports`,
  listByOlt: (oltId: string) =>
    api.get<PonPort[]>(`/v1/optical/olts/${oltId}/pon-ports`),
  create: (input: CreatePonPortInput) =>
    api.post<PonPort>('/v1/optical/pon-ports', input),
  update: (id: string, input: UpdatePonPortInput) =>
    api.patch<PonPort>(`/v1/optical/pon-ports/${id}`, input),
  remove: (id: string) => api.delete(`/v1/optical/pon-ports/${id}`),
};

// ─── Power budget AUTOMÁTICO ────────────────────────────────────────────────
export type PowerBudgetHopKind =
  | 'olt-tx'
  | 'fiber'
  | 'splice'
  | 'splitter'
  | 'connector'
  | 'unreachable';

export interface PowerBudgetHop {
  kind: PowerBudgetHopKind;
  label: string;
  lossDb: number;
  detail?: string;
}

export interface PowerBudgetAtResult {
  resolved: boolean;
  unresolvedReason?: string;
  path: PowerBudgetHop[];
  totalLossDb: number;
  origin?: {
    oltId: string;
    oltName: string;
    ponIndex: number;
    txPowerDbm: number;
  };
  predictedDbm: number | null;
}

export interface PowerBudgetAtParams {
  cableId: string;
  fiberIndex: number;
  distanceMeters?: number;
}

function qs(p: PowerBudgetAtParams): string {
  const u = new URLSearchParams();
  u.set('cableId', p.cableId);
  u.set('fiberIndex', String(p.fiberIndex));
  if (p.distanceMeters != null) {
    u.set('distanceMeters', String(p.distanceMeters));
  }
  return u.toString();
}

export const powerBudgetTraversalApi = {
  atPath: (p: PowerBudgetAtParams) => `/v1/optical/power-budget/at?${qs(p)}`,
  at: (p: PowerBudgetAtParams) =>
    api.get<PowerBudgetAtResult>(`/v1/optical/power-budget/at?${qs(p)}`),
};
