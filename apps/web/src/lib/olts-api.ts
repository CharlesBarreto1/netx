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

export const oltsApi = {
  listPath: (p: ListOltsParams = {}) => `/v1/olts${qs(p)}`,
  list: (p: ListOltsParams = {}) => api.get<Paginated<Olt>>(`/v1/olts${qs(p)}`),
  get: (id: string) => api.get<Olt>(`/v1/olts/${id}`),
  /** Vincula/desvincula POP. popId=null pra desvincular. */
  setPop: (oltId: string, popId: string | null) =>
    api.patch<Olt>(`/v1/olts/${oltId}`, { popId }),
};
