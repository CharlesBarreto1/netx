/**
 * Cliente tipado pro módulo Mapeamento.
 * Backend: apps/core-service/src/modules/mapping/*.
 */
import { api } from './api';
import type { ContractStatus } from './contracts-api';

export interface CustomerMapPoint {
  id: string;
  code: string | null;
  customerId: string;
  customerName: string;
  latitude: number;
  longitude: number;
  status: ContractStatus;
  /** Sessão RADIUS ativa (cliente realmente online agora). */
  online: boolean;
  /** Identificador exibido no popup pra debug (PPPoE/circuitId/MAC). */
  radiusIdentifier: string | null;
  planName: string | null;
  monthlyValue: number;
  installationAddress: string;
}

export interface CustomerMapResponse {
  points: CustomerMapPoint[];
  stats: {
    total: number;
    online: number;
    offline: number;
    suspended: number;
    pendingInstall: number;
    cancelled: number;
  };
}

export interface ListCustomerMapParams {
  /** CSV de status (ex: "ACTIVE,SUSPENDED"). Default = todos exceto CANCELLED. */
  status?: ContractStatus[];
  onlineOnly?: boolean;
  planId?: string;
}

function qs(params: ListCustomerMapParams = {}): string {
  const usp = new URLSearchParams();
  if (params.status && params.status.length > 0) {
    usp.set('status', params.status.join(','));
  }
  if (params.onlineOnly) usp.set('onlineOnly', 'true');
  if (params.planId) usp.set('planId', params.planId);
  const s = usp.toString();
  return s ? `?${s}` : '';
}

// ─── Network map (R1 + R2 — POPs, Equipamentos, OLTs, Caixas ópticas) ─────
export type NetworkMapPointKind =
  | 'POP'
  | 'BNG'
  | 'OLT'
  | 'ROUTER'
  | 'SWITCH'
  | 'OTHER'
  | 'CTO'
  | 'NAP'
  | 'SPLITTER'
  | 'EMENDA';

export interface NetworkMapPoint {
  id: string;
  kind: NetworkMapPointKind;
  name: string;
  code: string | null;
  latitude: number;
  longitude: number;
  popId: string | null;
  isActive: boolean;
  vendor: string | null;
  model: string | null;
  ipAddress: string | null;
  /** Ocupação % — só caixas ópticas. */
  occupancyPct?: number;
  /** Capacidade de portas — só caixas ópticas. */
  capacity?: number;
}

export interface NetworkMapResponse {
  points: NetworkMapPoint[];
  stats: {
    total: number;
    pops: number;
    equipment: number;
    olts: number;
    enclosures: number;
    withoutGeo: number;
  };
}

export interface ListNetworkMapParams {
  includePops?: boolean;
  includeEquipment?: boolean;
  includeOlts?: boolean;
  includeEnclosures?: boolean;
}

function qsNetwork(p: ListNetworkMapParams = {}): string {
  const usp = new URLSearchParams();
  if (p.includePops === false) usp.set('includePops', 'false');
  if (p.includeEquipment === false) usp.set('includeEquipment', 'false');
  if (p.includeOlts === false) usp.set('includeOlts', 'false');
  if (p.includeEnclosures === false) usp.set('includeEnclosures', 'false');
  const s = usp.toString();
  return s ? `?${s}` : '';
}

export const mappingApi = {
  customersPath: (params: ListCustomerMapParams = {}) =>
    `/v1/mapping/customers${qs(params)}`,
  listCustomers(params: ListCustomerMapParams = {}) {
    return api.get<CustomerMapResponse>(this.customersPath(params));
  },

  networkPath: (params: ListNetworkMapParams = {}) =>
    `/v1/mapping/network${qsNetwork(params)}`,
  listNetwork(params: ListNetworkMapParams = {}) {
    return api.get<NetworkMapResponse>(this.networkPath(params));
  },
};
