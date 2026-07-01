/**
 * Cliente tipado do módulo IPAM (documentação de IPs + CGNAT determinístico).
 */
import { api } from './api';

export type IpVersion = 'V4' | 'V6';
export type IpamPrefixRole =
  | 'SUPERNET'
  | 'CUSTOMER'
  | 'CGNAT_POOL'
  | 'PUBLIC_POOL'
  | 'MANAGEMENT'
  | 'LOOPBACK'
  | 'P2P'
  | 'DHCP'
  | 'OTHER';
export type IpamPrefixStatus = 'ACTIVE' | 'RESERVED' | 'DEPRECATED';
export type IpamAddressStatus = 'FREE' | 'USED' | 'RESERVED' | 'DHCP' | 'DEPRECATED';
export type IpamAddressKind = 'CONTRACT' | 'EQUIPMENT' | 'CUSTOMER' | 'GATEWAY' | 'OTHER';

interface Ref {
  id: string;
  name?: string;
  code?: string | null;
  cidr?: string;
  displayName?: string;
  pppoeUsername?: string | null;
}

export interface IpamPrefix {
  id: string;
  vrfId: string | null;
  parentId: string | null;
  cidr: string;
  version: IpVersion;
  prefixLen: number;
  firstAddr: string;
  lastAddr: string;
  role: IpamPrefixRole;
  status: IpamPrefixStatus;
  vlanId: number | null;
  gateway: string | null;
  description: string | null;
  usableHosts: string;
  usedCount: number;
  utilization: number | null;
  popId: string | null;
  equipmentId: string | null;
  customerId: string | null;
  pop?: Ref | null;
  customer?: Ref | null;
  equipment?: Ref | null;
  createdAt: string;
}

export interface IpamAddress {
  id: string;
  prefixId: string;
  address: string;
  addrNum: string;
  version: IpVersion;
  status: IpamAddressStatus;
  kind: IpamAddressKind | null;
  customerId: string | null;
  contractId: string | null;
  equipmentId: string | null;
  macAddress: string | null;
  hostname: string | null;
  description: string | null;
  isGateway: boolean;
  source: string | null;
  prefix?: Ref | null;
  customer?: Ref | null;
  contract?: Ref | null;
  equipment?: Ref | null;
  createdAt: string;
}

export interface IpamPool {
  id: string;
  prefixId: string;
  name: string;
  version: IpVersion;
  rangeStart: string;
  rangeEnd: string;
  startNum: string;
  endNum: string;
  description: string | null;
  isActive: boolean;
  prefix?: Ref | null;
}

export interface CgnatCapacity {
  blocksPerPublicIp: number;
  publicCount: string;
  cgnatCount: string;
  capacity: string;
  sufficient: boolean;
  spare: string;
}

export interface IpamCgnatPlan {
  id: string;
  name: string;
  publicPrefixId: string;
  cgnatPrefixId: string;
  portsPerClient: number;
  portBase: number;
  maxPort: number;
  description: string | null;
  generatedAt: string | null;
  entryCount: number;
  publicPrefix?: Ref | null;
  cgnatPrefix?: Ref | null;
  capacity?: CgnatCapacity;
}

export interface CgnatPreviewRow {
  privateIp: string;
  publicIp: string;
  portStart: number;
  portEnd: number;
}
export interface CgnatPreview {
  capacity: CgnatCapacity;
  total: string;
  offset: number;
  limit: number;
  rows: CgnatPreviewRow[];
}

export interface IpamLookupResult {
  query: { ip: string; port: number | null; at: string | null; version: number };
  directMatch: IpamAddress | null;
  cgnatMatch: {
    source: string;
    planName: string;
    privateIp: string;
    portStart: number | null;
    portEnd: number | null;
    contract: Ref | null;
    customer: Ref | null;
  } | null;
  radiusIp: string;
  radiusSessions: Array<{
    username: string | null;
    framedIp: string | null;
    online: boolean;
    sessionStart: string | null;
    sessionStop: string | null;
    callingStationId: string | null;
    nasIp: string | null;
  }>;
  resolved: {
    via: string | null;
    contract: Ref | null;
    customer: Ref | null;
  };
}

export interface CreatePrefixInput {
  cidr: string;
  vrfId?: string | null;
  role?: IpamPrefixRole;
  status?: IpamPrefixStatus;
  vlanId?: number | null;
  gateway?: string | null;
  description?: string | null;
  popId?: string | null;
  equipmentId?: string | null;
  customerId?: string | null;
}

export interface CreateAddressInput {
  address: string;
  prefixId?: string | null;
  status?: IpamAddressStatus;
  kind?: IpamAddressKind | null;
  customerId?: string | null;
  contractId?: string | null;
  equipmentId?: string | null;
  macAddress?: string | null;
  hostname?: string | null;
  description?: string | null;
  isGateway?: boolean;
}

export interface CreateCgnatInput {
  name: string;
  publicPrefixId: string;
  cgnatPrefixId: string;
  portsPerClient?: number;
  portBase?: number;
  maxPort?: number;
  description?: string | null;
}

export interface AllocateInput {
  prefixId?: string | null;
  poolId?: string | null;
  contractId?: string | null;
  customerId?: string | null;
  equipmentId?: string | null;
  description?: string | null;
}

export const ipamApi = {
  // Prefixos
  listPrefixes: (params?: { role?: string; q?: string }) => {
    const qs = new URLSearchParams();
    if (params?.role) qs.set('role', params.role);
    if (params?.q) qs.set('q', params.q);
    const s = qs.toString();
    return api.get<IpamPrefix[]>(`/v1/ipam/prefixes${s ? `?${s}` : ''}`);
  },
  getPrefix: (id: string) => api.get<IpamPrefix>(`/v1/ipam/prefixes/${id}`),
  createPrefix: (body: CreatePrefixInput) => api.post<IpamPrefix>('/v1/ipam/prefixes', body),
  updatePrefix: (id: string, body: Partial<CreatePrefixInput>) =>
    api.patch<IpamPrefix>(`/v1/ipam/prefixes/${id}`, body),
  deletePrefix: (id: string) => api.delete(`/v1/ipam/prefixes/${id}`),

  // Endereços
  listAddresses: (params?: {
    prefixId?: string;
    status?: string;
    contractId?: string;
    customerId?: string;
    q?: string;
  }) => {
    const qs = new URLSearchParams(
      Object.entries(params ?? {}).filter(([, v]) => v) as [string, string][],
    );
    const s = qs.toString();
    return api.get<IpamAddress[]>(`/v1/ipam/addresses${s ? `?${s}` : ''}`);
  },
  createAddress: (body: CreateAddressInput) => api.post<IpamAddress>('/v1/ipam/addresses', body),
  updateAddress: (id: string, body: Partial<CreateAddressInput>) =>
    api.patch<IpamAddress>(`/v1/ipam/addresses/${id}`, body),
  releaseAddress: (id: string) => api.delete(`/v1/ipam/addresses/${id}`),
  allocate: (body: AllocateInput) => api.post<IpamAddress>('/v1/ipam/addresses/allocate', body),

  // Pools
  listPools: (prefixId?: string) =>
    api.get<IpamPool[]>(`/v1/ipam/pools${prefixId ? `?prefixId=${prefixId}` : ''}`),
  createPool: (body: {
    name: string;
    prefixId: string;
    rangeStart: string;
    rangeEnd: string;
    description?: string | null;
  }) => api.post<IpamPool>('/v1/ipam/pools', body),
  deletePool: (id: string) => api.delete(`/v1/ipam/pools/${id}`),

  // CGNAT
  listCgnat: () => api.get<IpamCgnatPlan[]>('/v1/ipam/cgnat/plans'),
  getCgnat: (id: string) => api.get<IpamCgnatPlan>(`/v1/ipam/cgnat/plans/${id}`),
  createCgnat: (body: CreateCgnatInput) => api.post<IpamCgnatPlan>('/v1/ipam/cgnat/plans', body),
  updateCgnat: (id: string, body: Partial<CreateCgnatInput>) =>
    api.patch<IpamCgnatPlan>(`/v1/ipam/cgnat/plans/${id}`, body),
  deleteCgnat: (id: string) => api.delete(`/v1/ipam/cgnat/plans/${id}`),
  previewCgnat: (id: string, offset = 0, limit = 100) =>
    api.get<CgnatPreview>(`/v1/ipam/cgnat/plans/${id}/preview?offset=${offset}&limit=${limit}`),
  materializeCgnat: (id: string) =>
    api.post<{ entryCount: number }>(`/v1/ipam/cgnat/plans/${id}/materialize`),
  exportCgnatUrl: (id: string, format: 'csv' | 'mikrotik') =>
    `/v1/ipam/cgnat/plans/${id}/export?format=${format}`,
  exportCgnat: (id: string, format: 'csv' | 'mikrotik') =>
    api.get<string>(`/v1/ipam/cgnat/plans/${id}/export?format=${format}`),

  // Busca reversa
  lookup: (ip: string, port?: string, at?: string) => {
    const qs = new URLSearchParams({ ip });
    if (port) qs.set('port', port);
    if (at) qs.set('at', at);
    return api.get<IpamLookupResult>(`/v1/ipam/lookup?${qs.toString()}`);
  },
};
