/**
 * Cliente do módulo NMS (apps/nms) consumido a partir do shell do NetX.
 *
 * As chamadas vão pro gateway em `/v1/nms/*` (canal 4 do ecossistema): o
 * api-gateway repassa pro NMS preservando o Bearer do operador, e o NMS valida
 * esse mesmo JWT via SSO (canal 1). O entitlement `netx-nms` é checado no
 * gateway (canal 2, fail-open). Ver docs/ecosystem/INTEGRATION-RUNBOOK.md §A.
 *
 * Tipos locais (não importam de @netx/shared): o NMS é um sub-build isolado.
 * Espelham o contrato de `apps/nms/apps/web/src/api.ts`.
 */
import { api } from './api';

export type NmsVendor = 'juniper' | 'mikrotik' | 'cisco_iosxe';

export interface NmsDevice {
  id: string;
  hostname: string;
  mgmtIp: string;
  vendor: NmsVendor;
  model?: string | null;
  osVersion?: string | null;
  site?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateNmsDeviceRequest {
  hostname: string;
  mgmtIp: string;
  vendor: NmsVendor;
  model?: string;
  site?: string;
}

export type UpdateNmsDeviceRequest = Partial<CreateNmsDeviceRequest>;

export interface SetNmsCredentialRequest {
  username: string;
  password?: string;
  sshKey?: string;
  snmpCommunity?: string;
}

export interface ConnectivityResult {
  ssh?: { ok: boolean; detail?: string };
  netconf?: { ok: boolean; detail?: string };
  snmp?: { ok: boolean; detail?: string };
  [k: string]: unknown;
}

// ── Telemetria / dashboards ──────────────────────────────────────────────────
export interface NmsInterface {
  name: string;
  description: string | null;
  adminStatus: string;
  operStatus: string;
  speedBps: number | null;
}
export interface InterfaceRate {
  ifName: string;
  inBps: number | null;
  outBps: number | null;
  inErrors: number | null;
  outErrors: number | null;
  operStatus: number | null;
}
export interface OpticalReading {
  ifName: string;
  rxDbm: number | null;
  txDbm: number | null;
  moduleTempC: number | null;
}
export interface SystemReading {
  component: string;
  tempC: number | null;
  cpuPct: number | null;
}
export type EventSeverity = 'info' | 'warning' | 'error' | 'critical';
export interface DeviceEvent {
  ts: string;
  type: string;
  severity: EventSeverity;
  source: string;
  message: string | null;
}

// ── Playbooks (read-only) ────────────────────────────────────────────────────
export interface Playbook {
  id: string;
  name: string;
  command: string;
}
export interface PlaybookResult {
  playbookId: string;
  command: string;
  output: string;
}

// ── Backup / snapshots ───────────────────────────────────────────────────────
export interface ConfigSnapshot {
  id: string;
  gitHash: string;
  diffSummary: string | null;
  capturedAt: string;
}
export interface SnapshotDetail extends ConfigSnapshot {
  config: string;
  diff: string;
}
export interface BackupResult {
  changed: boolean;
  gitHash: string;
  diffSummary?: string;
}

// ── Aplicar config (escrita) ─────────────────────────────────────────────────
export interface PlanResult {
  ok: boolean;
  diff: string;
  detail: string;
}
export interface VerifyResult {
  ok: boolean;
  detail: string;
}
export interface ConfigApplyResult {
  ok: boolean;
  committed: boolean;
  rolledBack: boolean;
  diff: string;
  detail: string;
  confirmMinutes: number;
  changeId: string | null;
  verify: VerifyResult | null;
}
export interface ConfirmResult {
  ok: boolean;
  detail: string;
  changeId: string | null;
}
export type ConfigChangeStatus = 'planned' | 'applied' | 'confirmed' | 'rolled_back' | 'failed';
export interface ConfigChange {
  id: string;
  status: ConfigChangeStatus;
  actor: string;
  detail: string | null;
  confirmMinutes: number;
  confirmDeadline: string | null;
  verifyOk: boolean | null;
  verifyDetail: string | null;
  createdAt: string;
}

// ── IA (copiloto + anomalia) ─────────────────────────────────────────────────
// ── Telemetria agregada da frota (cockpit/dashboard NOC) ─────────────────────
export interface NmsFleetDevice {
  id: string;
  hostname: string;
  mgmtIp: string;
  vendor: NmsVendor;
  model: string | null;
  site: string | null;
  inBps: number;
  outBps: number;
  cpuPct: number | null;
  tempC: number | null;
  ifCount: number;
  online: boolean;
  lastSeen: string | null;
}
export interface NmsTrafficPoint {
  t: string;
  inBps: number;
  outBps: number;
}
export interface NmsFleetSummary {
  deviceCount: number;
  online: number;
  offline: number;
  totalInBps: number;
  totalOutBps: number;
  series: NmsTrafficPoint[];
  devices: NmsFleetDevice[];
}

export interface AiStatus {
  available: boolean;
}
export interface CopilotAnswer {
  question: string;
  answer: string;
}
export interface AnomalyScanResult {
  deviceId: string;
  found: number;
  anomalies?: Array<{ metric: string; detail: string; severity?: string }>;
}

const BASE = '/v1/nms';

export const nmsApi = {
  // Telemetria agregada da frota (dashboard NOC)
  summary: () => api.get<NmsFleetSummary>(`${BASE}/summary`),

  // Inventário
  listDevices: () => api.get<NmsDevice[]>(`${BASE}/devices`),
  getDevice: (id: string) => api.get<NmsDevice>(`${BASE}/devices/${id}`),
  createDevice: (body: CreateNmsDeviceRequest) => api.post<NmsDevice>(`${BASE}/devices`, body),
  updateDevice: (id: string, body: UpdateNmsDeviceRequest) =>
    api.put<NmsDevice>(`${BASE}/devices/${id}`, body),
  deleteDevice: (id: string) => api.delete<void>(`${BASE}/devices/${id}`),
  setCredentials: (id: string, body: SetNmsCredentialRequest) =>
    api.post<{ ok: true }>(`${BASE}/devices/${id}/credentials`, body),
  connectivityTest: (id: string) =>
    api.post<ConnectivityResult>(`${BASE}/devices/${id}/connectivity-test`),
  syncSnmp: (id: string) =>
    api.post<{ deviceId: string; action?: string }>(`${BASE}/devices/${id}/snmp-config/sync`),
  discoverInterfaces: (id: string) =>
    api.post<{ deviceId: string; discovered?: number }>(`${BASE}/devices/${id}/discover-interfaces`),

  // Telemetria
  interfaces: (id: string) => api.get<NmsInterface[]>(`${BASE}/devices/${id}/interfaces`),
  rates: (id: string) => api.get<InterfaceRate[]>(`${BASE}/devices/${id}/metrics/interfaces`),
  optical: (id: string) => api.get<OpticalReading[]>(`${BASE}/devices/${id}/metrics/optical`),
  system: (id: string) => api.get<SystemReading[]>(`${BASE}/devices/${id}/metrics/system`),
  events: (id: string) => api.get<DeviceEvent[]>(`${BASE}/devices/${id}/events`),

  // Playbooks
  playbooks: (vendor?: string) =>
    api.get<Playbook[]>(`${BASE}/playbooks${vendor ? `?vendor=${encodeURIComponent(vendor)}` : ''}`),
  runPlaybook: (id: string, playbookId: string) =>
    api.post<PlaybookResult>(`${BASE}/devices/${id}/playbooks/${playbookId}/run`),

  // Backup
  snapshots: (id: string) => api.get<ConfigSnapshot[]>(`${BASE}/devices/${id}/snapshots`),
  snapshot: (id: string, snapshotId: string) =>
    api.get<SnapshotDetail>(`${BASE}/devices/${id}/snapshots/${snapshotId}`),
  backup: (id: string) => api.post<BackupResult>(`${BASE}/devices/${id}/backup`),

  // Aplicar config
  config: {
    plan: (id: string, config: string) =>
      api.post<PlanResult>(`${BASE}/devices/${id}/config/plan`, { config }),
    apply: (id: string, config: string, confirmMinutes: number) =>
      api.post<ConfigApplyResult>(`${BASE}/devices/${id}/config/apply`, {
        config,
        confirmMinutes,
        approve: true,
      }),
    confirm: (id: string) => api.post<ConfirmResult>(`${BASE}/devices/${id}/config/confirm`),
    changes: (id: string) => api.get<ConfigChange[]>(`${BASE}/devices/${id}/config/changes`),
    pending: (id: string) => api.get<ConfigChange | null>(`${BASE}/devices/${id}/config/pending`),
  },

  // IA
  aiStatus: () => api.get<AiStatus>(`${BASE}/ai/status`),
  copilot: (id: string, question: string) =>
    api.post<CopilotAnswer>(`${BASE}/devices/${id}/copilot`, { question }),
  anomalyScan: (id: string) =>
    api.post<AnomalyScanResult>(`${BASE}/devices/${id}/anomaly-scan`),
};

export const NMS_VENDORS: { value: NmsVendor; label: string }[] = [
  { value: 'mikrotik', label: 'Mikrotik (RouterOS)' },
  { value: 'juniper', label: 'Juniper (Junos)' },
  { value: 'cisco_iosxe', label: 'Cisco IOS-XE (ASR)' },
];

/** URL do WebSocket do terminal SSH, via gateway/nginx → NMS (SSO por token na query). */
export function nmsTerminalWsUrl(deviceId: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const token = encodeURIComponent(localStorage.getItem('netx.accessToken') ?? '');
  return `${proto}://${window.location.host}/api${BASE}/ws/terminal?deviceId=${encodeURIComponent(deviceId)}&token=${token}`;
}
