/**
 * Cliente tipado pras OLTs (provisioning) — usado pelo estúdio (R8.2).
 * Backend: apps/core-service/src/modules/provisioning/olts.service.ts
 */
import { api } from './api';
import type { Paginated } from './crm-types';

export type OltVendor =
  | 'HUAWEI'
  | 'ZTE'
  | 'FIBERHOME'
  | 'PARKS'
  | 'NOKIA'
  | 'ZYXEL'
  | 'UFINET'
  | 'OTHER';
export type OltProviderMode = 'DIRECT' | 'ORCHESTRATOR' | 'EXTERNAL';
export type OltStatus = 'UNKNOWN' | 'ONLINE' | 'OFFLINE' | 'UNREACHABLE';

export interface Olt {
  id: string;
  tenantId: string;
  name: string;
  vendor: OltVendor;
  model: string;
  providerMode: OltProviderMode;
  managementIp: string | null;
  status: OltStatus;
  latitude: number | null;
  longitude: number | null;
  popId: string | null;
  pop: { id: string; name: string; code: string | null } | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListOltsParams {
  page?: number;
  pageSize?: number;
  vendor?: OltVendor;
  status?: OltStatus;
  search?: string;
  /** 'none' = só OLTs sem POP. UUID = OLTs daquele POP. */
  popId?: string | 'none';
}

function qs(p: ListOltsParams = {}): string {
  const u = new URLSearchParams();
  if (p.page) u.set('page', String(p.page));
  if (p.pageSize) u.set('pageSize', String(p.pageSize));
  if (p.vendor) u.set('vendor', p.vendor);
  if (p.status) u.set('status', p.status);
  if (p.search) u.set('search', p.search);
  if (p.popId) u.set('popId', p.popId);
  const s = u.toString();
  return s ? `?${s}` : '';
}

// =============================================================================
// Descoberta de ONU (integrador técnico) — staging discovered_onts
// =============================================================================
export type DiscoveredOntMatchState =
  | 'DISCOVERED'
  | 'MATCHED'
  | 'UNMATCHED'
  | 'AMBIGUOUS'
  | 'MATERIALIZED'
  | 'IGNORED';

export interface DiscoveredOnt {
  id: string;
  oltId: string;
  serial: string;
  slot: number;
  pon: number;
  onuIndex: number;
  model: string | null;
  onuState: string | null;
  macAddress: string | null;
  vlan: number | null;
  matchState: DiscoveredOntMatchState;
  erpCustomerCode: string | null;
  matchNote: string | null;
  lastSeenAt: string;
}

export interface DiscoveredOntList {
  total: number;
  byState: Record<string, number>;
  items: DiscoveredOnt[];
}

export interface OltScanResult {
  oltId: string;
  discovered: number;
  withMac: number;
  durationMs: number;
  error?: string;
}

export interface OltMatchResult {
  scanned: number;
  matched: number;
  unmatched: number;
  ambiguous: number;
  errors: number;
}

export interface OltMaterializeResult {
  processed: number;
  materialized: number;
  radiusEnqueued: number;
  skipped: number;
  failed: number;
  errors: Array<{ serial: string; message: string }>;
}

export const oltsApi = {
  listPath: (p: ListOltsParams = {}) => `/v1/olts${qs(p)}`,
  list: (p: ListOltsParams = {}) => api.get<Paginated<Olt>>(`/v1/olts${qs(p)}`),
  get: (id: string) => api.get<Olt>(`/v1/olts/${id}`),
  /** Vincula/desvincula POP. popId=null pra desvincular. */
  setPop: (oltId: string, popId: string | null) =>
    api.patch<Olt>(`/v1/olts/${oltId}`, { popId }),

  // ── Descoberta de ONU ──────────────────────────────────────────────────────
  /** Varre a OLT (opcionalmente 1 PON via slot/pon) e grava no staging. */
  scanOnts: (oltId: string, scope?: { slot: number; pon: number }) => {
    const q =
      scope !== undefined ? `?slot=${scope.slot}&pon=${scope.pon}` : '';
    return api.post<OltScanResult>(`/v1/olts/${oltId}/scan-onts${q}`);
  },
  /** Casa as ONUs descobertas contra o Hubsoft (por serial). */
  matchDiscovered: () => api.post<OltMatchResult>('/v1/olts/discovery/match'),
  /** Materializa os MATCHED em Contract+Ont (+RADIUS salvo noRadius). */
  materialize: (opts?: { ids?: string[]; noRadius?: boolean }) =>
    api.post<OltMaterializeResult>(
      `/v1/olts/discovery/materialize${opts?.noRadius ? '?noRadius=1' : ''}`,
      opts?.ids?.length ? { ids: opts.ids } : undefined,
    ),
  /** Lista o staging (para revisão). */
  listDiscovered: () => api.get<DiscoveredOntList>('/v1/olts/discovery/onts'),
  discoveredPath: () => '/v1/olts/discovery/onts',
};
