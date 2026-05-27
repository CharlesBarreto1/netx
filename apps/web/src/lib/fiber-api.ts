/**
 * Cliente tipado pros cabos de fibra (R3 OSP).
 * Backend: apps/core-service/src/modules/optical/fiber-cables.service.ts
 */
import { api } from './api';
import type { Paginated } from './crm-types';

export type FiberCableType = 'BACKBONE' | 'DISTRIBUTION' | 'DROP';

export const COMMON_FIBER_COUNTS = [2, 6, 12, 24, 48, 96, 144, 288] as const;

export interface PathPoint {
  latitude: number;
  longitude: number;
}

export interface FiberCableEndpointRef {
  id: string;
  code: string;
  type: 'CTO' | 'NAP' | 'SPLITTER' | 'EMENDA' | 'RESERVA';
}

export interface FiberCable {
  id: string;
  tenantId: string;
  code: string;
  type: FiberCableType;
  fiberCount: number;
  path: PathPoint[];
  lengthMeters: number;
  /** True se operador setou override; false se foi cálculo automático. */
  lengthOverridden: boolean;
  endpointAId: string | null;
  endpointA: FiberCableEndpointRef | null;
  endpointBId: string | null;
  endpointB: FiberCableEndpointRef | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateFiberCableInput {
  code: string;
  type: FiberCableType;
  fiberCount: number;
  path: PathPoint[];
  lengthMetersOverride?: number | null;
  endpointAId?: string | null;
  endpointBId?: string | null;
  notes?: string | null;
  isActive?: boolean;
}
export type UpdateFiberCableInput = Partial<CreateFiberCableInput>;

export interface ListFiberCablesParams {
  page?: number;
  pageSize?: number;
  type?: FiberCableType;
  search?: string;
}

function qs(p: ListFiberCablesParams = {}): string {
  const u = new URLSearchParams();
  if (p.page) u.set('page', String(p.page));
  if (p.pageSize) u.set('pageSize', String(p.pageSize));
  if (p.type) u.set('type', p.type);
  if (p.search) u.set('search', p.search);
  const s = u.toString();
  return s ? `?${s}` : '';
}

export const fiberCablesApi = {
  listPath: (p: ListFiberCablesParams = {}) => `/v1/optical/cables${qs(p)}`,
  list: (p: ListFiberCablesParams = {}) =>
    api.get<Paginated<FiberCable>>(`/v1/optical/cables${qs(p)}`),
  getPath: (id: string) => `/v1/optical/cables/${id}`,
  get: (id: string) => api.get<FiberCable>(`/v1/optical/cables/${id}`),
  create: (input: CreateFiberCableInput) =>
    api.post<FiberCable>('/v1/optical/cables', input),
  update: (id: string, input: UpdateFiberCableInput) =>
    api.patch<FiberCable>(`/v1/optical/cables/${id}`, input),
  remove: (id: string) => api.delete(`/v1/optical/cables/${id}`),
};

// ─── R4: Splices (fusões) ───────────────────────────────────────────────────
export type FiberSpliceLossClass =
  | 'unmeasured'
  | 'good'
  | 'warning'
  | 'bad';

export interface FiberSpliceColor {
  name: string;
  hex: string;
  tube?: number;
}

export interface FiberSpliceCableSummary {
  id: string;
  code: string;
  type: FiberCableType;
  fiberCount: number;
}

export interface FiberSplice {
  id: string;
  tenantId: string;
  latitude: number;
  longitude: number;
  cableAId: string;
  fiberAIndex: number;
  fiberAColor: FiberSpliceColor;
  cableA: FiberSpliceCableSummary;
  cableBId: string;
  fiberBIndex: number;
  fiberBColor: FiberSpliceColor;
  cableB: FiberSpliceCableSummary;
  lossDb: number | null;
  lossClass: FiberSpliceLossClass;
  photoUrl: string | null;
  measuredAt: string | null;
  measuredById: string | null;
  measuredBy: { firstName: string; lastName: string } | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateFiberSpliceInput {
  latitude: number;
  longitude: number;
  cableAId: string;
  fiberAIndex: number;
  cableBId: string;
  fiberBIndex: number;
  lossDb?: number | null;
  photoUrl?: string | null;
  measuredAt?: string | null;
  notes?: string | null;
}
export type UpdateFiberSpliceInput = Partial<CreateFiberSpliceInput>;

export interface ListFiberSplicesParams {
  page?: number;
  pageSize?: number;
  /** Filtra splices envolvendo este cabo (em A OU B). */
  cableId?: string;
}

function qsSplice(p: ListFiberSplicesParams = {}): string {
  const u = new URLSearchParams();
  if (p.page) u.set('page', String(p.page));
  if (p.pageSize) u.set('pageSize', String(p.pageSize));
  if (p.cableId) u.set('cableId', p.cableId);
  const s = u.toString();
  return s ? `?${s}` : '';
}

// ─── R4.5a: Topology (snapshot agregado de uma caixa) ─────────────────────
export interface TopologyEnclosure {
  id: string;
  code: string;
  type: 'CTO' | 'NAP' | 'SPLITTER' | 'EMENDA' | 'RESERVA';
  latitude: number;
  longitude: number;
  capacity: number;
  splitterRatio:
    | 'ONE_TO_2'
    | 'ONE_TO_4'
    | 'ONE_TO_8'
    | 'ONE_TO_16'
    | 'ONE_TO_32'
    | 'ONE_TO_64'
    | null;
}

export interface TopologyChildSplitter {
  id: string;
  code: string;
  type: 'SPLITTER';
  splitterRatio: TopologyEnclosure['splitterRatio'];
  capacity: number;
  portsUsed: number;
  portsTotal: number;
}

export interface TopologyCable {
  id: string;
  code: string;
  type: FiberCableType;
  fiberCount: number;
  endpointRole: 'A' | 'B';
  otherEndpointId: string | null;
  otherEndpointCode: string | null;
  lengthMeters: number;
}

export interface TopologySplice {
  id: string;
  cableAId: string;
  cableACode: string;
  fiberAIndex: number;
  fiberAColorHex: string;
  cableBId: string;
  cableBCode: string;
  fiberBIndex: number;
  fiberBColorHex: string;
  lossDb: number | null;
  lossClass: 'unmeasured' | 'good' | 'warning' | 'bad';
}

export interface TopologyPort {
  id: string;
  number: number;
  status: 'FREE' | 'RESERVED' | 'USED' | 'DAMAGED';
  contract: {
    id: string;
    code: string | null;
    customerDisplayName: string;
  } | null;
}

export interface EnclosureTopology {
  enclosure: TopologyEnclosure;
  childSplitters: TopologyChildSplitter[];
  incomingCables: TopologyCable[];
  splices: TopologySplice[];
  ports: TopologyPort[];
}

export const enclosureTopologyApi = {
  path: (id: string) => `/v1/optical/enclosures/${id}/topology`,
  get: (id: string) =>
    api.get<EnclosureTopology>(`/v1/optical/enclosures/${id}/topology`),
};

export const fiberSplicesApi = {
  listPath: (p: ListFiberSplicesParams = {}) =>
    `/v1/optical/splices${qsSplice(p)}`,
  list: (p: ListFiberSplicesParams = {}) =>
    api.get<Paginated<FiberSplice>>(`/v1/optical/splices${qsSplice(p)}`),
  get: (id: string) => api.get<FiberSplice>(`/v1/optical/splices/${id}`),
  create: (input: CreateFiberSpliceInput) =>
    api.post<FiberSplice>('/v1/optical/splices', input),
  update: (id: string, input: UpdateFiberSpliceInput) =>
    api.patch<FiberSplice>(`/v1/optical/splices/${id}`, input),
  remove: (id: string) => api.delete(`/v1/optical/splices/${id}`),
};

// TIA-598 — replicado do shared pra evitar import server-only.
// Ciclo de 12 cores que se repete pra cabos com >12 fibras (em tubos).
export const TIA598_COLORS = [
  { name: 'Azul',      hex: '#1e40af' },
  { name: 'Laranja',   hex: '#ea580c' },
  { name: 'Verde',     hex: '#16a34a' },
  { name: 'Marrom',    hex: '#78350f' },
  { name: 'Cinza',     hex: '#6b7280' },
  { name: 'Branco',    hex: '#f3f4f6' },
  { name: 'Vermelho',  hex: '#dc2626' },
  { name: 'Preto',     hex: '#0f172a' },
  { name: 'Amarelo',   hex: '#facc15' },
  { name: 'Violeta',   hex: '#7c3aed' },
  { name: 'Rosa',      hex: '#ec4899' },
  { name: 'Aqua',      hex: '#06b6d4' },
] as const;

export function fiberColorClient(index: number): FiberSpliceColor {
  if (index < 1) return { name: '—', hex: '#9ca3af' };
  const colorIdx = (index - 1) % 12;
  const tube = Math.floor((index - 1) / 12) + 1;
  return {
    name: TIA598_COLORS[colorIdx].name,
    hex: TIA598_COLORS[colorIdx].hex,
    tube: tube > 1 ? tube : undefined,
  };
}
