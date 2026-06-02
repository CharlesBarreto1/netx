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

export interface OntActionResult {
  status: 'completed' | 'failed' | 'pending';
  orderId: string | null;
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
  /** Ações de manutenção/diagnóstico na ONT (REFRESH/RESET/STATUS_ONT). */
  ontAction: (contractId: string, action: OntAction) =>
    api.post<OntActionResult>(
      `/v1/ufinet/services/contract/${contractId}/ont-action`,
      { action },
    ),
};
