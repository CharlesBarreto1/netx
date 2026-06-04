/**
 * Cliente tipado pros serviços Ufinet (rede neutra PY).
 * Backend: apps/core-service/src/modules/ufinet/ufinet.controller.ts
 */
import { api } from './api';

export type UfinetLifecycle =
  | 'PENDING_PROVIDE'
  | 'PROVIDING'
  | 'RESERVED'
  | 'CONFIRMING_ONT'
  | 'CONFIRMING_SERVICE'
  | 'ACTIVE'
  | 'SUSPENDING'
  | 'SUSPENDED'
  | 'REACTIVATING'
  | 'CEASING'
  | 'CEASED'
  | 'CANCELLING'
  | 'CANCELLED'
  | 'FAILED';

export interface UfinetService {
  id: string;
  contractId: string;
  oltId: string;
  oltName: string | null;
  externalId: string;
  labelDrop: string;
  bandwidthProfile: string;
  lifecycle: UfinetLifecycle;
  ufinetContractId: string | null;
  serviceOrderId: string | null;
  parentServiceId: string | null;
  resPonAccessServiceId: string | null;
  ctoPort: string | null;
  dropPort: string | null;
  serialNumber: string | null;
  /** Última leitura de níveis ópticos (STATUS_ONT) — exibida sempre no contrato. */
  lastSignalLevels: Array<{ name: string; value: string }> | null;
  lastSignalAt: string | null;
  ufinetState: string | null;
  waitingCode: string | null;
  attempts: number;
  nextAttemptAt: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UfinetTraceEntry {
  id: string;
  method: string;
  path: string;
  status: number | null;
  durationMs: number;
  requestBody: unknown;
  responseBody: unknown;
  error: string | null;
  createdAt: string;
}

export type OntAction = 'REFRESH_ONT' | 'RESET_ONT' | 'STATUS_ONT';

export interface OntActionDispatch {
  orderId: string | null;
  status: 'dispatched' | 'failed';
  message?: string;
}

export interface OntActionResult {
  status: 'completed' | 'failed' | 'pending';
  characteristics: Array<{ name: string; value: string }>;
  message?: string;
}

export const ufinetApi = {
  byContractPath: (contractId: string) => `/v1/ufinet/services/contract/${contractId}`,
  byContract: (contractId: string) =>
    api.get<UfinetService | null>(`/v1/ufinet/services/contract/${contractId}`),
  retry: (id: string) =>
    api.post<UfinetService>(`/v1/ufinet/services/${id}/retry`, { resetAttempts: true }),
  trace: (id: string) => api.get<UfinetTraceEntry[]>(`/v1/ufinet/services/${id}/trace`),
  /**
   * Ações de manutenção/diagnóstico na ONT (REFRESH/RESET/STATUS_ONT).
   * Assíncrono: `dispatch` dispara e devolve orderId; `result` consulta até
   * completar (a cadeia orquestrador→NCS→OLT→ONT é lenta).
   */
  ontActionDispatch: (contractId: string, action: OntAction) =>
    api.post<OntActionDispatch>(
      `/v1/ufinet/services/contract/${contractId}/ont-action`,
      { action },
    ),
  ontActionResult: (contractId: string, orderId: string) =>
    api.get<OntActionResult>(
      `/v1/ufinet/services/contract/${contractId}/ont-action/${orderId}`,
    ),
  /** Adota um serviço já ativo na Ufinet (cadastrado manualmente lá). */
  adopt: (contractId: string, oltId: string) =>
    api.post<UfinetService>('/v1/ufinet/services/adopt', { contractId, oltId }),
};
