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
  apiConfig: Record<string, unknown> | null;
  serviceVlanId: number | null;
  defaultUpProfile: string | null;
  defaultDownProfile: string | null;
  status: OltStatus;
  lastSeenAt: string | null;
  lastError: string | null;
  latitude: number | null;
  longitude: number | null;
  ontsCount?: number;
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
  apiConfig?: Record<string, unknown> | null;
  serviceVlanId?: number | null;
  defaultUpProfile?: string | null;
  defaultDownProfile?: string | null;
  latitude?: number | null;
  longitude?: number | null;
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
  /** VLAN da WAN PPPoE (default 1010). */
  pppoeVlan?: number;
  /** Modo Wi-Fi do modelo da ONT (default BAND_STEERING). */
  wifiBandMode?: 'BAND_STEERING' | 'DUAL_BAND';
  notes?: string | null;
  /** Ufinet (rede neutra): caixa (CTO) + porta reais informadas pelo técnico. */
  ufinetCto?: string | null;
  ufinetPort?: string | null;
}

export interface OntSwapRequest {
  /** ONT nova do estoque (caminho normal). */
  newSerialItemId?: string | null;
  /** Serial manual — só com allowStockBypass=true. */
  newSnGpon?: string | null;
  allowStockBypass?: boolean;
  /** Local de estoque onde devolver a ONT antiga. */
  returnLocationId: string;
  ssid: string;
  wifiPassword: string;
  wifiBandMode?: 'BAND_STEERING' | 'DUAL_BAND';
}

export interface OntSwapResponse {
  status: 'OK' | 'PARTIAL' | 'FAILED';
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
  complianceStatus: Tr069ComplianceStatus;
  profileId: string | null;
  lastInformAt: string | null;
  lastInformReason: string | null;
  ont: {
    id: string;
    snGpon: string;
    contractId: string;
    contract: { code: string | null; customer: { id: string; displayName: string } | null } | null;
  } | null;
  _count: { tasks: number };
}

// ── Conformidade / profiles (espelha @netx/shared/provisioning/tr069.dto) ─────
export type Tr069ComplianceStatus =
  | 'UNKNOWN'
  | 'COMPLIANT'
  | 'DRIFTED'
  | 'REMEDIATING'
  | 'PENDING_REBOOT'
  | 'FAILED';
export type Tr069RuleSource =
  | 'STATIC'
  | 'CONTRACT_PPPOE_USER'
  | 'CONTRACT_PPPOE_PASS'
  | 'CONTRACT_PPPOE_VLAN'
  | 'CONTRACT_WIFI_SSID'
  | 'CONTRACT_WIFI_SSID_5G'
  | 'CONTRACT_WIFI_PASS';
export type Tr069RuleMode = 'ENFORCE' | 'REPORT_ONLY';
export type Tr069DriftStatus = 'OPEN' | 'REMEDIATING' | 'PENDING_REBOOT' | 'RESOLVED' | 'FAILED';

export const TR069_RULE_SOURCE_LABELS: Record<Tr069RuleSource, string> = {
  STATIC: 'Valor fixo',
  CONTRACT_PPPOE_USER: 'PPPoE — usuário',
  CONTRACT_PPPOE_PASS: 'PPPoE — senha',
  CONTRACT_PPPOE_VLAN: 'PPPoE — VLAN',
  CONTRACT_WIFI_SSID: 'Wi-Fi — SSID 2.4G',
  CONTRACT_WIFI_SSID_5G: 'Wi-Fi — SSID 5G',
  CONTRACT_WIFI_PASS: 'Wi-Fi — senha',
};

/** Rótulo + classes Tailwind por status de conformidade (badge inline). */
export const COMPLIANCE_META: Record<Tr069ComplianceStatus, { label: string; cls: string }> = {
  COMPLIANT: {
    label: 'Conforme',
    cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  },
  DRIFTED: {
    label: 'Divergente',
    cls: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  },
  REMEDIATING: {
    label: 'Corrigindo',
    cls: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300',
  },
  PENDING_REBOOT: {
    label: 'Aguardando reboot',
    cls: 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300',
  },
  FAILED: { label: 'Falhou', cls: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300' },
  UNKNOWN: {
    label: 'Sem dados',
    cls: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
  },
};

export interface Tr069ProfileRule {
  id: string;
  param: string;
  valueType: string;
  source: Tr069RuleSource;
  staticValue: string | null;
  mode: Tr069RuleMode;
  requiresReboot: boolean;
  enabled: boolean;
  sortOrder: number;
}
export interface Tr069ProfileRuleInput {
  param: string;
  valueType: string;
  source: Tr069RuleSource;
  staticValue?: string | null;
  mode: Tr069RuleMode;
  requiresReboot: boolean;
  enabled: boolean;
  sortOrder: number;
}
export interface Tr069Profile {
  id: string;
  name: string;
  manufacturer: string;
  productClass: string | null;
  firmwarePattern: string | null;
  version: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  rules: Tr069ProfileRule[];
  deviceCount: number;
}
export interface Tr069ProfileSummary {
  id: string;
  name: string;
  manufacturer: string;
  productClass: string | null;
  version: number;
  active: boolean;
  ruleCount: number;
  deviceCount: number;
  updatedAt: string;
}
export interface Tr069Drift {
  id: string;
  param: string;
  expected: string | null;
  actual: string | null;
  status: Tr069DriftStatus;
  requiresReboot: boolean;
  attempts: number;
  detectedAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
}
export interface Tr069DeviceCompliance {
  complianceStatus: Tr069ComplianceStatus;
  profileId: string | null;
  profileName: string | null;
  lastReconciledAt: string | null;
  pendingRebootSince: string | null;
  drifts: Tr069Drift[];
}
export interface CreateTr069ProfileBody {
  name: string;
  manufacturer: string;
  productClass?: string | null;
  firmwarePattern?: string | null;
  active?: boolean;
  rules?: Tr069ProfileRuleInput[];
}

// ── Diagnóstico (espelha @netx/shared/provisioning/tr069.dto) ─────────────────
export type Tr069OpticalHealth = 'OK' | 'WARNING' | 'CRITICAL' | 'UNKNOWN';
export type Tr069AlertType =
  | 'OPTICAL_RX_LOW'
  | 'OPTICAL_RX_HIGH'
  | 'OPTICAL_TX_ABNORMAL'
  | 'DEVICE_OFFLINE'
  | 'WIFI_WEAK_CLIENT'
  | 'WIFI_HIGH_UTIL';
export type Tr069AlertSeverity = 'INFO' | 'WARNING' | 'CRITICAL';
export type Tr069AlertStatus = 'OPEN' | 'RESOLVED';

/** Limiares de RX (dBm) — espelho de OPTICAL_RX_THRESHOLDS do shared. */
export const OPTICAL_RX_THRESHOLDS = {
  critHigh: -5,
  warnHigh: -8,
  warnLow: -25,
  critLow: -27,
} as const;

/** Classifica a saúde do RX óptico pra colorir a UI (mesma regra do backend). */
export function classifyRxPower(rx: number | null | undefined): Tr069OpticalHealth {
  if (rx === null || rx === undefined || Number.isNaN(rx)) return 'UNKNOWN';
  const t = OPTICAL_RX_THRESHOLDS;
  if (rx < t.critLow || rx > t.critHigh) return 'CRITICAL';
  if (rx < t.warnLow || rx > t.warnHigh) return 'WARNING';
  return 'OK';
}

export interface Tr069WifiClient {
  mac: string | null;
  band: string;
  rssi: number | null;
  txRate: number | null;
  rxRate: number | null;
}

export interface Tr069LanHost {
  mac: string | null;
  ip: string | null;
  hostname: string | null;
  active: boolean | null;
}

export interface Tr069DiagnosticDto {
  id: string;
  capturedAt: string;
  rxPower: number | null;
  txPower: number | null;
  temperature: number | null;
  voltage: number | null;
  biasCurrent: number | null;
  opticalHealth: Tr069OpticalHealth;
  gponStatus: string | null;
  fecErrors: number | null;
  hecErrors: number | null;
  dropRate: number | null;
  errorRate: number | null;
  pppStatus: string | null;
  pppLastError: string | null;
  wanUptime: number | null;
  hostsCount: number | null;
  hosts: Tr069LanHost[];
  wifiClients24: number | null;
  wifiClients5: number | null;
  wifiChannel24: number | null;
  wifiChannel5: number | null;
  wifiWorstRssi: number | null;
  wifiClients: Tr069WifiClient[];
}

export interface Tr069AlertDto {
  id: string;
  deviceId: string;
  type: Tr069AlertType;
  severity: Tr069AlertSeverity;
  status: Tr069AlertStatus;
  message: string;
  value: number | null;
  openedAt: string;
  resolvedAt: string | null;
  lastSeenAt: string;
  device?: { id: string; deviceId: string; ontSnGpon: string | null } | null;
}

export interface Tr069TaskDto {
  id: string;
  action: string;
  status: string;
  attempts: number;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface Tr069DeviceDetailResponse {
  id: string;
  deviceId: string;
  manufacturer: string | null;
  oui: string | null;
  productClass: string | null;
  hardwareVersion: string | null;
  softwareVersion: string | null;
  status: string;
  lastInformAt: string | null;
  lastInformReason: string | null;
  lastDiagnosticAt: string | null;
  connectionRequestUrl: string | null;
  ont: {
    id: string;
    snGpon: string;
    contractId: string;
    status: string;
    lastRxPower: string | null;
    lastTxPower: string | null;
  } | null;
  customer: {
    customerId: string;
    customerName: string;
    customerStatus: string;
    contractId: string;
    contractCode: string | null;
    contractStatus: string;
    pppoeUsername: string | null;
  } | null;
  latest: Tr069DiagnosticDto | null;
  openAlerts: Tr069AlertDto[];
  recentTasks: Tr069TaskDto[];
}

export interface Tr069RefreshResponse {
  taskId: string;
  message: string;
}

export interface WifiCoverageRow {
  deviceId: string;
  deviceLabel: string;
  ontSnGpon: string | null;
  contractId: string | null;
  contractCode: string | null;
  customerId: string | null;
  customerName: string | null;
  avgRssi: number | null;
  worstRssi: number | null;
  samples: number;
  lastSeenAt: string | null;
}

export type Tr069DiagKind = 'DOWNLOAD' | 'UPLOAD' | 'PING' | 'TRACEROUTE';
export type Tr069DiagState = 'REQUESTED' | 'COMPLETED' | 'ERROR';

export interface Tr069DiagRunDto {
  id: string;
  kind: Tr069DiagKind;
  state: Tr069DiagState;
  target: string | null;
  throughputKbps: number | null;
  pingSuccess: number | null;
  pingFailure: number | null;
  pingAvgMs: number | null;
  pingMinMs: number | null;
  pingMaxMs: number | null;
  errorText: string | null;
  createdAt: string;
  completedAt: string | null;
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
  /** Migra todas as ONTs desta OLT pra outra (rede própria). */
  migrateOnts: (id: string, targetOltId: string) =>
    api.post<{ migrated: number }>(`/v1/olts/${id}/migrate-onts`, { targetOltId }),
};

// =============================================================================
// /v1/provisioning
// =============================================================================
export const provisioningApi = {
  listPending: (params?: { page?: number; pageSize?: number; search?: string }) =>
    api.get<Paginated<PendingInstallItem>>(`/v1/provisioning/pending${qs(params)}`),
  install: (contractId: string, body: InstallCustomerRequest) =>
    api.post<InstallCustomerResponse>(`/v1/provisioning/install/${contractId}`, body),
  swapOnt: (contractId: string, body: OntSwapRequest) =>
    api.post<OntSwapResponse>(`/v1/provisioning/contracts/${contractId}/swap-ont`, body),
  /** Re-tenta o provisionamento da mesma ONT (re-sync RADIUS + TR-069). */
  reprovision: (contractId: string) =>
    api.post<InstallCustomerResponse>(`/v1/provisioning/contracts/${contractId}/reprovision`, {}),
  /** Desfaz a instalação — volta o contrato pra PENDING_INSTALL. */
  deactivateInstall: (contractId: string, returnLocationId: string) =>
    api.post<{ status: string }>(
      `/v1/provisioning/contracts/${contractId}/deactivate`,
      { returnLocationId },
    ),
  ontStatus: (ontId: string) => api.get<OntStatusResponse>(`/v1/provisioning/onts/${ontId}/status`),
};

// =============================================================================
// /v1/tr069 (Fase 3 entrega lógica real)
// =============================================================================
export const tr069Api = {
  listDevices: () => api.get<Tr069DeviceRow[]>('/v1/tr069/devices'),
  getDevice: (id: string) => api.get<Tr069DeviceDetailResponse>(`/v1/tr069/devices/${id}`),
  byContractPath: (contractId: string) => `/v1/tr069/by-contract/${contractId}`,
  byContract: (contractId: string) =>
    api.get<Tr069DeviceDetailResponse | null>(`/v1/tr069/by-contract/${contractId}`),
  listTasksForDevice: (deviceId: string) =>
    api.get<unknown[]>(`/v1/tr069/devices/${deviceId}/tasks`),
  diagnostics: (id: string, limit = 100) =>
    api.get<Tr069DiagnosticDto[]>(`/v1/tr069/devices/${id}/diagnostics${qs({ limit })}`),
  refresh: (id: string) => api.post<Tr069RefreshResponse>(`/v1/tr069/devices/${id}/refresh`, {}),
  reboot: (id: string) => api.post<{ taskId: string }>(`/v1/tr069/devices/${id}/reboot`, {}),
  firmwareUpgrade: (id: string, body: { url: string; fileType?: string; targetFileName?: string }) =>
    api.post<{ taskId: string }>(`/v1/tr069/devices/${id}/firmware`, body),
  speedTest: (id: string, url?: string) =>
    api.post<{ runId: string; message: string }>(`/v1/tr069/devices/${id}/speedtest`, url ? { url } : {}),
  ping: (id: string, host: string) =>
    api.post<{ runId: string; message: string }>(`/v1/tr069/devices/${id}/ping`, { host }),
  diagRuns: (id: string) => api.get<Tr069DiagRunDto[]>(`/v1/tr069/devices/${id}/diag-runs`),
  deviceParameters: (id: string) =>
    api.get<Array<{ name: string; value: string }>>(`/v1/tr069/devices/${id}/parameters`),
  wifiCoverage: (params?: { days?: number; maxRssi?: number; minSamples?: number; page?: number; pageSize?: number }) =>
    api.get<Paginated<WifiCoverageRow>>(`/v1/tr069/wifi-coverage${qs(params)}`),
  listAlerts: (params?: {
    status?: Tr069AlertStatus;
    severity?: Tr069AlertSeverity;
    deviceId?: string;
    page?: number;
    pageSize?: number;
  }) => api.get<Paginated<Tr069AlertDto>>(`/v1/tr069/alerts${qs(params)}`),
  cancelTask: (taskId: string) => api.delete<void>(`/v1/tr069/tasks/${taskId}`),
  // ── Conformidade / profiles (Fase 4) ───────────────────────────────────────
  deviceCompliance: (id: string) =>
    api.get<Tr069DeviceCompliance>(`/v1/tr069/devices/${id}/compliance`),
  reconcile: (id: string) =>
    api.post<{ ok: boolean; complianceStatus: Tr069ComplianceStatus; message: string }>(
      `/v1/tr069/devices/${id}/reconcile`,
      {},
    ),
  listProfiles: () => api.get<Tr069ProfileSummary[]>('/v1/tr069/profiles'),
  getProfile: (id: string) => api.get<Tr069Profile>(`/v1/tr069/profiles/${id}`),
  createProfile: (body: CreateTr069ProfileBody) =>
    api.post<Tr069Profile>('/v1/tr069/profiles', body),
  updateProfile: (id: string, body: Partial<CreateTr069ProfileBody>) =>
    api.patch<Tr069Profile>(`/v1/tr069/profiles/${id}`, body),
  deleteProfile: (id: string) => api.delete<void>(`/v1/tr069/profiles/${id}`),
};
