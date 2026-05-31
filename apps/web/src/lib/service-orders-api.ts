/**
 * Cliente tipado para o módulo Ordens de Serviço (O.S).
 * Endpoints atrás do gateway em `/api/v1/service-orders` e
 * `/api/v1/service-order-reasons`.
 */
import { api } from './api';
import type { Paginated } from './crm-types';

// =============================================================================
// TYPES
// =============================================================================
export type ServiceOrderStatus =
  | 'OPEN'
  | 'SCHEDULED'
  | 'EN_ROUTE'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED';

/** Inclui OVERDUE — derivado pelo backend, não persistido. */
export type ServiceOrderDisplayStatus =
  | 'OPEN'
  | 'SCHEDULED'
  | 'EN_ROUTE'
  | 'IN_PROGRESS'
  | 'OVERDUE'
  | 'COMPLETED'
  | 'CANCELLED';

export interface ServiceOrderPhotoResponse {
  id: string;
  storageKey: string;
  contentType: string | null;
  caption: string | null;
  createdAt: string;
  url?: string;
}

export interface ServiceOrderResponse {
  id: string;
  tenantId: string;
  contractId: string;
  reasonId: string;
  code: string | null;
  status: ServiceOrderStatus;
  displayStatus: ServiceOrderDisplayStatus;
  openedAt: string;
  scheduledAt: string | null;
  enRouteAt: string | null;
  checkinAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  openDescription: string;
  closeDescription: string | null;
  city: string | null;
  state: string | null;
  assignedToId: string | null;
  createdAt: string;
  updatedAt: string;
  reason?: { id: string; name: string } | null;
  contract?: {
    id: string;
    code: string | null;
    // null em contratos IPoE.
    pppoeUsername: string | null;
    customerId: string;
  } | null;
  customer?: { id: string; displayName: string } | null;
  assignedTo?: {
    id: string;
    firstName: string;
    lastName: string;
  } | null;
  photos?: ServiceOrderPhotoResponse[];
}

export interface ServiceOrderReasonResponse {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  isActive: boolean;
  /** Quando true, OS com esse motivo só pode ser fechada com equipamento em comodato. */
  isInstallation: boolean;
  order: number;
  createdAt: string;
  updatedAt: string;
}

// =============================================================================
// CORES (mapping do briefing)
// =============================================================================
/**
 * Tom da Badge por displayStatus, conforme briefing:
 *   Aberta=Amarela, Agendada=Azul, Em Execução=Roxa, Atrasada=Vermelha,
 *   Finalizada=Verde. Cancelada=Cinza (extra).
 */
export const SO_STATUS_TONE: Record<
  ServiceOrderDisplayStatus,
  'warning' | 'info' | 'purple' | 'danger' | 'success' | 'neutral'
> = {
  OPEN: 'warning',
  SCHEDULED: 'info',
  EN_ROUTE: 'info',
  IN_PROGRESS: 'purple',
  OVERDUE: 'danger',
  COMPLETED: 'success',
  CANCELLED: 'neutral',
};

// =============================================================================
// QUERY HELPER
// =============================================================================
// Aceita qualquer interface/type via `object` constraint (interfaces TS não têm
// index signature, então `Record<string, unknown>` quebra). O cast interno é
// safe: nunca acessamos props arbitrárias, só iteramos `Object.entries`.
function qs<T extends object>(params: T | Record<string, never> = {}): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params as Record<string, unknown>)) {
    if (v === undefined || v === null || v === '') continue;
    usp.set(k, String(v));
  }
  const s = usp.toString();
  return s ? `?${s}` : '';
}

// =============================================================================
// SERVICE ORDERS
// =============================================================================
export interface ListServiceOrdersParams {
  page?: number;
  pageSize?: number;
  contractId?: string;
  customerId?: string;
  reasonId?: string;
  /** UUID do técnico OU 'unassigned' pra filtrar O.S órfãs. */
  assignedToId?: string | 'unassigned';
  status?: ServiceOrderDisplayStatus;
  city?: string;
  scheduledFrom?: string;
  scheduledTo?: string;
  search?: string;
  sortBy?: 'scheduledAt' | 'openedAt' | 'createdAt' | 'updatedAt';
  sortDir?: 'asc' | 'desc';
}

export interface CreateServiceOrderInput {
  contractId: string;
  reasonId: string;
  code?: string;
  scheduledAt?: string | null;
  openDescription: string;
  city?: string | null;
  state?: string | null;
  assignedToId?: string | null;
}

export interface UpdateServiceOrderInput {
  reasonId?: string;
  scheduledAt?: string | null;
  openDescription?: string;
  closeDescription?: string | null;
  city?: string | null;
  state?: string | null;
  assignedToId?: string | null;
}

export interface CompleteServiceOrderInput {
  closeDescription: string;
  completedAt?: string;
}

export interface CancelServiceOrderInput {
  reason?: string;
}

// ── One-touch (tela /os do técnico) ─────────────────────────────────────────
/** Campos de provisionamento (mesmo shape do /provisioning/install). */
export interface InstallFieldsInput {
  oltId: string;
  serialItemId?: string | null;
  allowStockBypass?: boolean;
  snGpon?: string | null;
  ponFrame?: number;
  ponSlot?: number;
  macAddress?: string | null;
  serialPhysical?: string | null;
  ssid: string;
  wifiPassword: string;
  wifiBandMode?: 'BAND_STEERING' | 'DUAL_BAND';
  pppoeVlan?: number;
  notes?: string | null;
  ufinetCto?: string | null;
  ufinetPort?: string | null;
}

export interface FieldMaterialInput {
  productId: string;
  locationId: string;
  quantity: number;
  notes?: string | null;
}

export interface ServiceOrderPhotoInput {
  storageKey: string;
  contentType?: string | null;
  sizeBytes?: number | null;
  caption?: string | null;
}

export interface CompleteInstallationInput {
  install: InstallFieldsInput;
  enclosureId?: string | null;
  enclosurePort?: string | null;
  materials?: FieldMaterialInput[];
  photos?: ServiceOrderPhotoInput[];
  closeDescription: string;
  completedAt?: string;
}

export interface PhotoPresignResponse {
  uploadUrl: string;
  storageKey: string;
  expiresIn: number;
}

export interface InstallTimelineEvent {
  action: string;
  status: string;
  message?: string;
  error?: string | null;
  durationMs?: number;
}

export interface CompleteInstallationResult {
  serviceOrder: ServiceOrderResponse;
  install: {
    status: 'OK' | 'PARTIAL' | 'FAILED';
    timeline: InstallTimelineEvent[];
    pollUrl?: string;
  };
}

export const serviceOrdersApi = {
  listPath: (params: ListServiceOrdersParams = {}) =>
    `/v1/service-orders${qs(params)}`,
  list(params: ListServiceOrdersParams = {}) {
    return api.get<Paginated<ServiceOrderResponse>>(this.listPath(params));
  },
  getPath: (id: string) => `/v1/service-orders/${id}`,
  get(id: string) {
    return api.get<ServiceOrderResponse>(this.getPath(id));
  },
  create(input: CreateServiceOrderInput) {
    return api.post<ServiceOrderResponse>('/v1/service-orders', input);
  },
  update(id: string, input: UpdateServiceOrderInput) {
    return api.patch<ServiceOrderResponse>(`/v1/service-orders/${id}`, input);
  },
  start(id: string, startedAt?: string) {
    return api.post<ServiceOrderResponse>(`/v1/service-orders/${id}/start`, {
      ...(startedAt ? { startedAt } : {}),
    });
  },
  complete(id: string, input: CompleteServiceOrderInput) {
    return api.post<ServiceOrderResponse>(
      `/v1/service-orders/${id}/complete`,
      input,
    );
  },
  cancel(id: string, input: CancelServiceOrderInput = {}) {
    return api.post<ServiceOrderResponse>(
      `/v1/service-orders/${id}/cancel`,
      input,
    );
  },
  // ── Lifecycle de campo + one-touch ──
  enRoute(id: string) {
    return api.post<ServiceOrderResponse>(
      `/v1/service-orders/${id}/en-route`,
      {},
    );
  },
  checkin(id: string) {
    return api.post<ServiceOrderResponse>(
      `/v1/service-orders/${id}/checkin`,
      {},
    );
  },
  presignPhoto(id: string, fileName: string, contentType?: string) {
    return api.post<PhotoPresignResponse>(
      `/v1/service-orders/${id}/photos/presign`,
      { fileName, ...(contentType ? { contentType } : {}) },
    );
  },
  completeInstallation(id: string, input: CompleteInstallationInput) {
    return api.post<CompleteInstallationResult>(
      `/v1/service-orders/${id}/complete-installation`,
      input,
    );
  },
  remove(id: string) {
    return api.delete(`/v1/service-orders/${id}`);
  },
};

// =============================================================================
// REASONS
// =============================================================================
export interface CreateServiceOrderReasonInput {
  name: string;
  description?: string | null;
  isActive?: boolean;
  isInstallation?: boolean;
  order?: number;
}

export interface UpdateServiceOrderReasonInput {
  name?: string;
  description?: string | null;
  isActive?: boolean;
  isInstallation?: boolean;
  order?: number;
}

export const serviceOrderReasonsApi = {
  path: (includeInactive = false) =>
    `/v1/service-order-reasons${includeInactive ? '?includeInactive=true' : ''}`,
  list(includeInactive = false) {
    return api.get<ServiceOrderReasonResponse[]>(this.path(includeInactive));
  },
  create(input: CreateServiceOrderReasonInput) {
    return api.post<ServiceOrderReasonResponse>(
      '/v1/service-order-reasons',
      input,
    );
  },
  update(id: string, input: UpdateServiceOrderReasonInput) {
    return api.patch<ServiceOrderReasonResponse>(
      `/v1/service-order-reasons/${id}`,
      input,
    );
  },
  remove(id: string) {
    return api.delete(`/v1/service-order-reasons/${id}`);
  },
};
