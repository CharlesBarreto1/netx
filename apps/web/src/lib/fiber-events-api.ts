/**
 * Cliente tipado pros eventos OTDR (R6 OSP).
 * Backend: apps/core-service/src/modules/optical/fiber-events.service.ts
 */
import { api } from './api';
import type { Paginated } from './crm-types';

export type FiberEventType =
  | 'BREAK'
  | 'BEND'
  | 'REFLECTION'
  | 'ATTENUATION'
  | 'CONNECTOR'
  | 'OTHER';

export interface FiberEvent {
  id: string;
  tenantId: string;
  cableId: string;
  cable: { id: string; code: string; lengthMeters: number };
  distanceMeters: number;
  fiberIndex: number | null;
  latitude: number;
  longitude: number;
  type: FiberEventType;
  lossDb: number | null;
  reportedAt: string;
  reportedById: string | null;
  reportedBy: { firstName: string; lastName: string } | null;
  resolvedAt: string | null;
  resolvedById: string | null;
  resolvedBy: { firstName: string; lastName: string } | null;
  isActive: boolean;
  photoUrl: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateFiberEventInput {
  cableId: string;
  distanceMeters: number;
  fiberIndex?: number | null;
  type: FiberEventType;
  lossDb?: number | null;
  reportedAt?: string | null;
  photoUrl?: string | null;
  notes?: string | null;
}

export interface ListFiberEventsParams {
  page?: number;
  pageSize?: number;
  cableId?: string;
  type?: FiberEventType;
  status?: 'active' | 'resolved' | 'all';
}

function qs(p: ListFiberEventsParams = {}): string {
  const u = new URLSearchParams();
  if (p.page) u.set('page', String(p.page));
  if (p.pageSize) u.set('pageSize', String(p.pageSize));
  if (p.cableId) u.set('cableId', p.cableId);
  if (p.type) u.set('type', p.type);
  if (p.status) u.set('status', p.status);
  const s = u.toString();
  return s ? `?${s}` : '';
}

export const fiberEventsApi = {
  listPath: (p: ListFiberEventsParams = {}) => `/v1/optical/events${qs(p)}`,
  list: (p: ListFiberEventsParams = {}) =>
    api.get<Paginated<FiberEvent>>(`/v1/optical/events${qs(p)}`),
  get: (id: string) => api.get<FiberEvent>(`/v1/optical/events/${id}`),
  create: (input: CreateFiberEventInput) =>
    api.post<FiberEvent>('/v1/optical/events', input),
  resolve: (id: string, notes?: string) =>
    api.post<FiberEvent>(`/v1/optical/events/${id}/resolve`, {
      notes: notes ?? null,
    }),
  reopen: (id: string) =>
    api.post<FiberEvent>(`/v1/optical/events/${id}/reopen`, {}),
  remove: (id: string) => api.delete(`/v1/optical/events/${id}`),
};
