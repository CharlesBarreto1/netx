/**
 * Cliente tipado pro módulo Optical (R2 OSP).
 * Backend: apps/core-service/src/modules/optical/*
 */
import { api } from './api';
import type { Paginated } from './crm-types';

export type OpticalEnclosureType =
  | 'CTO'
  | 'NAP'
  | 'SPLITTER'
  | 'EMENDA'
  | 'RESERVA';

export type SplitterRatio =
  | 'ONE_TO_2'
  | 'ONE_TO_4'
  | 'ONE_TO_8'
  | 'ONE_TO_16'
  | 'ONE_TO_32'
  | 'ONE_TO_64';

export type OpticalMountType =
  | 'POSTE'
  | 'AEREO'
  | 'SUBTERRANEO'
  | 'PAREDE'
  | 'RACK';

export type OpticalPortStatus = 'FREE' | 'RESERVED' | 'USED' | 'DAMAGED';

// Quantidade de portas pra cada ratio (UI sugere capacity ao escolher).
export const SPLITTER_OUTPUT_COUNT: Record<SplitterRatio, number> = {
  ONE_TO_2: 2,
  ONE_TO_4: 4,
  ONE_TO_8: 8,
  ONE_TO_16: 16,
  ONE_TO_32: 32,
  ONE_TO_64: 64,
};

// Loss dB por ratio (usado depois no R5 power budget).
export const SPLITTER_LOSS_DB: Record<SplitterRatio, number> = {
  ONE_TO_2: 3.5,
  ONE_TO_4: 7.0,
  ONE_TO_8: 10.5,
  ONE_TO_16: 14.0,
  ONE_TO_32: 17.0,
  ONE_TO_64: 20.5,
};

export interface OpticalEnclosureStats {
  portsTotal: number;
  portsFree: number;
  portsReserved: number;
  portsUsed: number;
  portsDamaged: number;
  occupancyPct: number;
}

export interface OpticalEnclosure {
  id: string;
  tenantId: string;
  code: string;
  type: OpticalEnclosureType;
  parentId: string | null;
  latitude: number;
  longitude: number;
  mountType: OpticalMountType | null;
  splitterRatio: SplitterRatio | null;
  capacity: number;
  locationLabel: string | null;
  notes: string | null;
  isActive: boolean;
  /** Vínculo de rede (provisionamento). oltName vem enriquecido do backend. */
  oltId: string | null;
  oltName: string | null;
  ponPortId: string | null;
  createdAt: string;
  updatedAt: string;
  stats?: OpticalEnclosureStats;
}

export interface OpticalPort {
  id: string;
  tenantId: string;
  enclosureId: string;
  number: number;
  status: OpticalPortStatus;
  contractId: string | null;
  contract?: {
    id: string;
    code: string | null;
    customer: { id: string; displayName: string };
  } | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateEnclosureInput {
  code: string;
  type: OpticalEnclosureType;
  parentId?: string | null;
  latitude: number;
  longitude: number;
  mountType?: OpticalMountType | null;
  splitterRatio?: SplitterRatio | null;
  capacity: number;
  locationLabel?: string | null;
  notes?: string | null;
  isActive?: boolean;
  oltId?: string | null;
  ponPortId?: string | null;
}
export type UpdateEnclosureInput = Partial<CreateEnclosureInput>;

export interface UpdatePortInput {
  status: OpticalPortStatus;
  contractId?: string | null;
  notes?: string | null;
}

export interface ListEnclosuresParams {
  page?: number;
  pageSize?: number;
  type?: OpticalEnclosureType;
  parentId?: string;
  search?: string;
  oltId?: string;
}

function qs(p: ListEnclosuresParams = {}): string {
  const u = new URLSearchParams();
  if (p.page) u.set('page', String(p.page));
  if (p.pageSize) u.set('pageSize', String(p.pageSize));
  if (p.type) u.set('type', p.type);
  if (p.parentId) u.set('parentId', p.parentId);
  if (p.search) u.set('search', p.search);
  if (p.oltId) u.set('oltId', p.oltId);
  const s = u.toString();
  return s ? `?${s}` : '';
}

export const opticalApi = {
  // Enclosures
  listPath: (p: ListEnclosuresParams = {}) => `/v1/optical/enclosures${qs(p)}`,
  list: (p: ListEnclosuresParams = {}) =>
    api.get<Paginated<OpticalEnclosure>>(`/v1/optical/enclosures${qs(p)}`),
  /** Só os IDs que casam com o filtro — pra "selecionar todas". */
  listIds: (p: ListEnclosuresParams = {}) =>
    api.get<string[]>(`/v1/optical/enclosures/ids${qs(p)}`),
  getPath: (id: string) => `/v1/optical/enclosures/${id}`,
  get: (id: string) => api.get<OpticalEnclosure>(`/v1/optical/enclosures/${id}`),
  create: (input: CreateEnclosureInput) =>
    api.post<OpticalEnclosure>('/v1/optical/enclosures', input),
  update: (id: string, input: UpdateEnclosureInput) =>
    api.patch<OpticalEnclosure>(`/v1/optical/enclosures/${id}`, input),
  remove: (id: string) => api.delete(`/v1/optical/enclosures/${id}`),
  /** Atribui OLT a várias caixas (ação em massa). oltId=null limpa. */
  assignOlt: (enclosureIds: string[], oltId: string | null) =>
    api.post<{ updated: number }>('/v1/optical/enclosures/assign-olt', {
      enclosureIds,
      oltId,
    }),

  // Ports
  portsPath: (enclosureId: string) =>
    `/v1/optical/enclosures/${enclosureId}/ports`,
  listPorts: (enclosureId: string) =>
    api.get<OpticalPort[]>(`/v1/optical/enclosures/${enclosureId}/ports`),
  updatePort: (portId: string, input: UpdatePortInput) =>
    api.patch<OpticalPort>(`/v1/optical/ports/${portId}`, input),
};
