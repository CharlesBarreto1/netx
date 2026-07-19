/**
 * Cliente tipado pro módulo Network.
 */
import { api } from './api';

export type EquipmentType = 'BNG' | 'OLT' | 'ROUTER' | 'SWITCH' | 'OTHER';
export type EquipmentVendor =
  | 'MIKROTIK'
  | 'HUAWEI'
  | 'ZTE'
  | 'FIBERHOME'
  | 'CISCO'
  | 'JUNIPER'
  | 'OTHER';

/** Estratégia de disconnect. AUTO escolhe baseado em vendor + authType do contrato. */
export type DisconnectStrategy = 'AUTO' | 'COA' | 'MIKROTIK_API' | 'SSH';

/** Resultado de uma strategy no Test Connection. */
export interface TestConnectionStrategyResult {
  strategy: 'COA' | 'MIKROTIK_API' | 'SSH';
  ok: boolean;
  message?: string;
}
export interface TestConnectionResponse {
  equipmentId: string;
  name: string;
  results: TestConnectionStrategyResult[];
}

export interface NetworkPop {
  id: string;
  tenantId: string;
  name: string;
  code: string | null;
  city: string | null;
  state: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  _count?: { equipment: number };
}

export interface NetworkEquipment {
  id: string;
  tenantId: string;
  popId: string | null;
  type: EquipmentType;
  vendor: EquipmentVendor;
  name: string;
  hostname: string | null;
  ipAddress: string;
  radiusSecret: string | null;
  radiusNasType: string | null;
  snmpCommunity: string | null;
  snmpVersion: string | null;
  // Multi-vendor disconnect
  disconnectStrategy: DisconnectStrategy;
  coaPort: number | null;
  apiHost: string | null;
  apiPort: number | null;
  apiUser: string | null;
  apiTlsEnabled: boolean;
  /** Indica que apiPassword está cifrada no banco. Plaintext nunca volta no GET. */
  hasApiPassword?: boolean;
  sshHost: string | null;
  sshPort: number | null;
  sshUser: string | null;
  sshKeyName: string | null;
  sshDisconnectCmd: string | null;
  hasSshPassword?: boolean;
  lastReachableAt: string | null;
  lastReachError: string | null;
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  pop?: { id: string; name: string; code: string | null } | null;
}

export interface CreatePopInput {
  name: string;
  code?: string;
  city?: string;
  state?: string;
  address?: string;
  latitude?: number | null;
  longitude?: number | null;
  notes?: string;
  isActive?: boolean;
}
export type UpdatePopInput = Partial<CreatePopInput>;

export interface CreateEquipmentInput {
  popId?: string | null;
  /** Bem do estoque que este equipamento é — consome o patrimônio no cadastro. */
  serialItemId?: string | null;
  type: EquipmentType;
  vendor?: EquipmentVendor;
  name: string;
  hostname?: string;
  ipAddress: string;
  radiusSecret?: string;
  radiusNasType?: string;
  snmpCommunity?: string;
  snmpVersion?: string;
  // Multi-vendor disconnect — todos opcionais, default no backend
  disconnectStrategy?: DisconnectStrategy;
  coaPort?: number | null;
  apiHost?: string | null;
  apiPort?: number | null;
  apiUser?: string | null;
  /** Plaintext — backend cifra com KMS antes de salvar. */
  apiPassword?: string | null;
  apiTlsEnabled?: boolean;
  sshHost?: string | null;
  sshPort?: number | null;
  sshUser?: string | null;
  sshPassword?: string | null;
  sshKeyName?: string | null;
  sshDisconnectCmd?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  notes?: string;
  isActive?: boolean;
}
export type UpdateEquipmentInput = Partial<CreateEquipmentInput>;

export const networkApi = {
  // POPs
  popsListPath: () => '/v1/network/pops',
  listPops: () => api.get<NetworkPop[]>('/v1/network/pops'),
  getPop: (id: string) => api.get<NetworkPop>(`/v1/network/pops/${id}`),
  createPop: (input: CreatePopInput) =>
    api.post<NetworkPop>('/v1/network/pops', input),
  updatePop: (id: string, input: UpdatePopInput) =>
    api.patch<NetworkPop>(`/v1/network/pops/${id}`, input),
  deletePop: (id: string) => api.delete(`/v1/network/pops/${id}`),

  // Equipamentos
  equipmentListPath: (filter?: { type?: EquipmentType; popId?: string }) => {
    const u = new URLSearchParams();
    if (filter?.type) u.set('type', filter.type);
    if (filter?.popId) u.set('popId', filter.popId);
    const qs = u.toString();
    return `/v1/network/equipment${qs ? '?' + qs : ''}`;
  },
  listEquipment(filter?: { type?: EquipmentType; popId?: string }) {
    return api.get<NetworkEquipment[]>(this.equipmentListPath(filter));
  },
  getEquipment: (id: string) =>
    api.get<NetworkEquipment>(`/v1/network/equipment/${id}`),
  createEquipment: (input: CreateEquipmentInput) =>
    api.post<NetworkEquipment>('/v1/network/equipment', input),
  updateEquipment: (id: string, input: UpdateEquipmentInput) =>
    api.patch<NetworkEquipment>(`/v1/network/equipment/${id}`, input),
  deleteEquipment: (id: string) =>
    api.delete(`/v1/network/equipment/${id}`),
  resyncBngs: () =>
    api.post<{ totalBngs: number; synced: number }>(
      '/v1/network/equipment/_resync-bngs',
    ),

  /** Testa conectividade nas strategies disponíveis (CoA / Mikrotik API / SSH). */
  testConnection: (id: string) =>
    api.post<TestConnectionResponse>(
      `/v1/network/equipment/${id}/test-connection`,
    ),
};
