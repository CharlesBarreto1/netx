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
