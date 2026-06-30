/**
 * Cliente do módulo NMS (apps/nms) consumido a partir do shell do NetX.
 *
 * As chamadas vão pro gateway em `/v1/nms/*` (canal 4 do ecossistema): o
 * api-gateway repassa pro NMS preservando o Bearer do operador, e o NMS valida
 * esse mesmo JWT via SSO (canal 1). O entitlement `netx-nms` é checado no
 * gateway (canal 2, fail-open). Ver docs/ecosystem/INTEGRATION-RUNBOOK.md §A.
 *
 * Tipos locais (não importam de @netx/shared): o NMS é um sub-build isolado.
 */
import { api } from './api';

export type NmsVendor = 'juniper' | 'mikrotik';

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

const BASE = '/v1/nms';

export const nmsApi = {
  listDevices: () => api.get<NmsDevice[]>(`${BASE}/devices`),
  createDevice: (body: CreateNmsDeviceRequest) =>
    api.post<NmsDevice>(`${BASE}/devices`, body),
  updateDevice: (id: string, body: UpdateNmsDeviceRequest) =>
    api.put<NmsDevice>(`${BASE}/devices/${id}`, body),
  deleteDevice: (id: string) => api.delete<void>(`${BASE}/devices/${id}`),
  setCredentials: (id: string, body: SetNmsCredentialRequest) =>
    api.post<{ ok: true }>(`${BASE}/devices/${id}/credentials`, body),
  connectivityTest: (id: string) =>
    api.post<ConnectivityResult>(`${BASE}/devices/${id}/connectivity-test`),
};

export const NMS_VENDORS: { value: NmsVendor; label: string }[] = [
  { value: 'mikrotik', label: 'Mikrotik (RouterOS)' },
  { value: 'juniper', label: 'Juniper (Junos)' },
];
