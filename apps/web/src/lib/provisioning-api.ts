/**
 * Cliente tipado pra endpoints de provisionamento (OLT/ONT + TR-069).
 * Rotas: /api/v1/olts/*, /api/v1/provisioning/*, /api/v1/tr069/*.
 *
 * Mirror dos types em @netx/shared/provisioning. Mantido local pra evitar
 * dep no shared em dev (mesmo padrão das outras *-api.ts).
 */
import { api } from './api';
import type { Paginated } from './crm-types';

/** Monta query string filtrando valores null/undefined/'' */
function qs(params: Record<string, unknown> | undefined): string {
  if (!params) return '';
  const entries = Object.entries(params).filter(
    ([, v]) => v !== undefined && v !== null && v !== '',
  );
  if (entries.length === 0) return '';
  return '?' + new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString();
}

// =============================================================================
// Tipos espelhados de @netx/shared/provisioning
// =============================================================================
export type OltVendor =
  | 'HUAWEI'
  | 'ZTE'
  | 'DATACOM'
  | 'FIBERHOME'
  | 'NOKIA'
  | 'PARKS'
  | 'UFINET'
  | 'GENERIC';

export type OltProviderMode = 'DIRECT' | 'ORCHESTRATOR' | 'EXTERNAL';
export type OltStatus = 'ONLINE' | 'OFFLINE' | 'UNREACHABLE' | 'UNKNOWN';

export type OntStatus =
  | 'PENDING_AUTH'
  | 'AUTHORIZED'
  | 'ONLINE'
  | 'OFFLINE'
  | 'LOS'
  | 'FAULT';

export interface Olt {
  id: string;
  tenantId: string;
  name: string;
  vendor: OltVendor;
  model: string;
  providerMode: OltProviderMode;
  managementIp: string | null;
  sshPort: number;
  sshUser: string | null;
  hasSshPassword: boolean;
  hasEnableSecret: boolean;
  apiEndpoint: string | null;
  apiAuthType: 'OAUTH2' | 'API_KEY' | 'MTLS' | null;
  hasApiCredentials: boolean;
  hasApiWebhookSecret: boolean;
  serviceVlanId: number | null;
  defaultUpProfile: string | null;
  defaultDownProfile: string | null;
  status: OltStatus;
  lastSeenAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateOltRequest {
  name: string;
  vendor: OltVendor;
  model: string;
  providerMode: OltProviderMode;
  managementIp?: string | null;
  sshPort?: number;
  sshUser?: string | null;
  sshPassword?: string | null;
  enableSecret?: string | null;
  apiEndpoint?: string | null;
  apiAuthType?: 'OAUTH2' | 'API_KEY' | 'MTLS' | null;
  apiCredentials?: Record<string, unknown> | null;
  apiWebhookSecret?: string | null;
  serviceVlanId?: number | null;
  defaultUpProfile?: string | null;
  defaultDownProfile?: string | null;
}

export type UpdateOltRequest = Partial<CreateOltRequest>;

export interface PendingInstallItem {
  contractId: string;
  contractCode: string | null;
  customerId: string;
  customerName: string;
  installationAddress: string;
  bandwidthMbps: number;
  monthlyValue: string;
  createdAt: string;
}

export interface InstallCustomerRequest {
  oltId: string;
  /** Equipamento do estoque (caminho normal). */
  serialItemId?: string | null;
  /** Bypass de validação de estoque (debug/migração). Quando true, exige snGpon. */
  allowStockBypass?: boolean;
  /** Só quando allowStockBypass=true; em modo normal vem do SerialItem. */
  snGpon?: string | null;
  ponFrame?: number | null;
  ponSlot?: number | null;
  macAddress?: string | null;
  serialPhysical?: string | null;
  ssid: string;
  wifiPassword: string;
  notes?: string | null;
}

export interface InstallTimelineEvent {
  action:
    | 'OLT_AUTHORIZE'
    | 'OLT_DEAUTHORIZE'
    | 'OLT_STATUS_POLL'
    | 'OLT_TEST_CONNECTION'
    | 'TR069_TASK_ENQUEUE'
    | 'TR069_INFORM_RECEIVED'
    | 'RADIUS_ENQUEUE'
    | 'CONTRACT_ACTIVATE';
  status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'TIMEOUT';
  message: string;
  durationMs: number | null;
  at: string;
  error?: string | null;
}

export interface InstallCustomerResponse {
  contractId: string;
  ontId: string;
  status: 'OK' | 'PARTIAL' | 'FAILED';
  timeline: InstallTimelineEvent[];
  pollUrl?: string;
}

export interface OntStatusResponse {
  id: string;
  contractId: string;
  oltId: string;
  oltName: string;
  snGpon: string;
  macAddress: string | null;
  status: OntStatus;
  ponFrame: number | null;
  ponSlot: number | null;
  ponOnuIndex: number | null;
  lastRxPower: string | null;
  lastTxPower: string | null;
  authorizedAt: string | null;
  lastSeenAt: string | null;
  lastError: string | null;
}

export interface Tr069DeviceRow {
  id: string;
  deviceId: string;
  manufacturer: string | null;
  productClass: string | null;
  softwareVersion: string | null;
  status: string;
  lastInformAt: string | null;
  lastInformReason: string | null;
  ont: { id: string; snGpon: string; contractId: string } | null;
  _count: { tasks: number };
}

// =============================================================================
// /v1/olts
// =============================================================================
export const oltsApi = {
  list: (params?: { page?: number; pageSize?: number; vendor?: OltVendor; status?: OltStatus; search?: string }) =>
    api.get<Paginated<Olt>>(`/v1/olts${qs(params)}`),
  get: (id: string) => api.get<Olt>(`/v1/olts/${id}`),
  create: (body: CreateOltRequest) => api.post<Olt>('/v1/olts', body),
  update: (id: string, body: UpdateOltRequest) => api.patch<Olt>(`/v1/olts/${id}`, body),
  remove: (id: string) => api.delete<void>(`/v1/olts/${id}`),
  testConnection: (id: string) =>
    api.post<{ success: boolean; message: string; durationMs: number }>(
      `/v1/olts/${id}/test-connection`,
      {},
    ),
};

// =============================================================================
// /v1/provisioning
// =============================================================================
export const provisioningApi = {
  listPending: (params?: { page?: number; pageSize?: number; search?: string }) =>
    api.get<Paginated<PendingInstallItem>>(`/v1/provisioning/pending${qs(params)}`),
  install: (contractId: string, body: InstallCustomerRequest) =>
    api.post<InstallCustomerResponse>(`/v1/provisioning/install/${contractId}`, body),
  ontStatus: (ontId: string) => api.get<OntStatusResponse>(`/v1/provisioning/onts/${ontId}/status`),
};

// =============================================================================
// /v1/tr069 (Fase 3 entrega lógica real)
// =============================================================================
export const tr069Api = {
  listDevices: () => api.get<Tr069DeviceRow[]>('/v1/tr069/devices'),
  listTasksForDevice: (deviceId: string) =>
    api.get<unknown[]>(`/v1/tr069/devices/${deviceId}/tasks`),
  cancelTask: (taskId: string) => api.delete<void>(`/v1/tr069/tasks/${taskId}`),
};
