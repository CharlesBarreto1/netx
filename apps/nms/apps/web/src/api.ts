export interface Device {
  id: string;
  hostname: string;
  mgmtIp: string;
  vendor: string;
  model: string | null;
  site: string | null;
}
export interface DeviceInterface {
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
export interface DeviceEvent {
  ts: string;
  type: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  source: string;
  message: string | null;
}
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

export type Vendor = 'juniper' | 'mikrotik' | 'cisco_iosxe';
export interface DeviceInput {
  hostname: string;
  mgmtIp: string;
  vendor: Vendor;
  model?: string;
  osVersion?: string;
  site?: string;
}
export interface ChannelCheck {
  reachable: boolean;
  detail?: string;
  applicable?: boolean;
}
export interface ConnectivityResult {
  deviceId: string;
  ok: boolean;
  checks?: { ssh: ChannelCheck; netconf: ChannelCheck; snmp: ChannelCheck };
  error?: string;
}
export interface CredentialStatus {
  deviceId: string;
  username: string;
  hasPassword: boolean;
  hasSshKey: boolean;
  hasSnmpCommunity: boolean;
}

// ── Autenticação (ADR 0007) ─────────────────────────────────────────────────
export type Role = 'admin' | 'operator' | 'viewer';
export interface AuthUser {
  id: string;
  username: string;
  role: Role;
}
export interface UserView extends AuthUser {
  name: string | null;
  active: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

const TOKEN_KEY = 'netx_nms_token';

/** Disparado quando o token é rejeitado (401), para a UI voltar ao login. */
export const onUnauthorized = new EventTarget();

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}
export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = getToken();
  return { ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra };
}

/** Trata 401 (limpa token + sinaliza UI) e erros; devolve corpo JSON ou undefined em 204. */
async function handle<T>(r: Response, path: string): Promise<T> {
  if (r.status === 401) {
    clearToken();
    onUnauthorized.dispatchEvent(new Event('unauthorized'));
    throw new Error('Sessão expirada — faça login novamente');
  }
  if (!r.ok) {
    const body = (await r.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? `${path} → HTTP ${r.status}`);
  }
  if (r.status === 204) return undefined as T;
  return r.json() as Promise<T>;
}

async function get<T>(path: string): Promise<T> {
  return handle<T>(await fetch(`/api${path}`, { headers: authHeaders() }), path);
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`/api${path}`, {
    method: 'POST',
    headers: authHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify(body),
  });
  return handle<T>(r, path);
}

async function putJson<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`/api${path}`, {
    method: 'PUT',
    headers: authHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify(body),
  });
  return handle<T>(r, path);
}

async function del(path: string): Promise<void> {
  await handle<void>(
    await fetch(`/api${path}`, { method: 'DELETE', headers: authHeaders() }),
    path,
  );
}

export interface CopilotAnswer {
  question: string;
  answer: string;
}

async function post<T>(path: string): Promise<T> {
  const r = await fetch(`/api${path}`, { method: 'POST', headers: authHeaders() });
  return handle<T>(r, path);
}

export interface LoginResult {
  token: string;
  user: AuthUser;
}

export const api = {
  login: async (username: string, password: string): Promise<AuthUser> => {
    const r = await postJson<LoginResult>('/auth/login', { username, password });
    setToken(r.token);
    return r.user;
  },
  logout: () => clearToken(),
  me: () => get<AuthUser>('/auth/me'),
  users: {
    list: () => get<UserView[]>('/users'),
    create: (body: { username: string; password: string; name?: string; role: Role }) =>
      postJson<UserView>('/users', body),
    update: (
      id: string,
      body: { name?: string | null; password?: string; role?: Role; active?: boolean },
    ) => putJson<UserView>(`/users/${id}`, body),
    remove: (id: string) => del(`/users/${id}`),
  },
  devices: () => get<Device[]>('/devices'),
  createDevice: (body: DeviceInput) => postJson<Device>('/devices', body),
  updateDevice: (id: string, body: Partial<DeviceInput>) => putJson<Device>(`/devices/${id}`, body),
  removeDevice: (id: string) => del(`/devices/${id}`),
  setCredentials: (
    id: string,
    body: { username: string; password?: string; sshKey?: string; snmpCommunity?: string },
  ) => postJson<CredentialStatus>(`/devices/${id}/credentials`, body),
  testConnectivity: (id: string) => post<ConnectivityResult>(`/devices/${id}/connectivity-test`),
  syncSnmp: (id: string) =>
    post<{ deviceId: string; action?: string }>(`/devices/${id}/snmp-config/sync`),
  discoverInterfaces: (id: string) =>
    post<{ deviceId: string; discovered?: number }>(`/devices/${id}/discover-interfaces`),
  interfaces: (id: string) => get<DeviceInterface[]>(`/devices/${id}/interfaces`),
  rates: (id: string) => get<InterfaceRate[]>(`/devices/${id}/metrics/interfaces`),
  optical: (id: string) => get<OpticalReading[]>(`/devices/${id}/metrics/optical`),
  system: (id: string) => get<SystemReading[]>(`/devices/${id}/metrics/system`),
  events: (id: string) => get<DeviceEvent[]>(`/devices/${id}/events`),
  playbooks: (vendor?: string) =>
    get<Playbook[]>(`/playbooks${vendor ? `?vendor=${encodeURIComponent(vendor)}` : ''}`),
  runPlaybook: (id: string, pb: string) =>
    post<PlaybookResult>(`/devices/${id}/playbooks/${pb}/run`),
  snapshots: (id: string) => get<ConfigSnapshot[]>(`/devices/${id}/snapshots`),
  snapshot: (id: string, snapId: string) =>
    get<SnapshotDetail>(`/devices/${id}/snapshots/${snapId}`),
  backup: (id: string) => post<BackupResult>(`/devices/${id}/backup`),
  config: {
    plan: (id: string, config: string) =>
      postJson<PlanResult>(`/devices/${id}/config/plan`, { config }),
    apply: (id: string, config: string, confirmMinutes: number) =>
      postJson<ConfigApplyResult>(`/devices/${id}/config/apply`, {
        config,
        confirmMinutes,
        approve: true,
      }),
    confirm: (id: string) => post<ConfirmResult>(`/devices/${id}/config/confirm`),
    changes: (id: string) => get<ConfigChange[]>(`/devices/${id}/config/changes`),
    pending: (id: string) => get<ConfigChange | null>(`/devices/${id}/config/pending`),
  },
  aiStatus: () => get<{ available: boolean }>('/ai/status'),
  copilot: (id: string, question: string) =>
    postJson<CopilotAnswer>(`/devices/${id}/copilot`, { question }),
};
