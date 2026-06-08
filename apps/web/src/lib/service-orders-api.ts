/**
 * Cliente tipado para o módulo Ordens de Serviço (O.S).
 * Endpoints atrás do gateway em `/api/v1/service-orders` e
 * `/api/v1/service-order-reasons`.
 */
import { api } from './api';
import type { Paginated } from './crm-types';
import type { InstallCustomerResponse } from './provisioning-api';

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

/** Classificação do motivo — ramifica o fluxo da tela /os. */
export type ServiceOrderReasonKind = 'INSTALLATION' | 'SUPPORT' | 'RETRIEVAL';

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
  fieldProvisionedAt: string | null;
  openDescription: string;
  closeDescription: string | null;
  city: string | null;
  state: string | null;
  assignedToId: string | null;
  createdAt: string;
  updatedAt: string;
  reason?: { id: string; name: string; kind: ServiceOrderReasonKind } | null;
  contract?: {
    id: string;
    code: string | null;
    // null em contratos IPoE.
    pppoeUsername: string | null;
    customerId: string;
    // Localização do contrato — pra navegação ("Iniciar deslocamento").
    installationAddress: string | null;
    installationMapsUrl: string | null;
    latitude: number | null;
    longitude: number | null;
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
  kind: ServiceOrderReasonKind;
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

/** Troca de ONT (suporte com troca). */
export interface OntSwapInput {
  newSerialItemId?: string | null;
  newSnGpon?: string | null;
  allowStockBypass?: boolean;
  returnLocationId: string;
  ssid: string;
  wifiPassword: string;
  wifiBandMode?: 'BAND_STEERING' | 'DUAL_BAND';
}

/** Finalização de campo, discriminada por `mode` (montado a partir de reason.kind). */
export type CompleteFieldInput =
  | {
      mode: 'INSTALLATION';
      install: InstallFieldsInput;
      enclosureId?: string | null;
      enclosurePort?: string | null;
      materials?: FieldMaterialInput[];
      photos?: ServiceOrderPhotoInput[];
      closeDescription: string;
      completedAt?: string;
    }
  | {
      mode: 'SUPPORT';
      materials?: FieldMaterialInput[];
      photos?: ServiceOrderPhotoInput[];
      closeDescription: string;
      completedAt?: string;
    }
  | {
      mode: 'SUPPORT_SWAP';
      swap: OntSwapInput;
      materials?: FieldMaterialInput[];
      photos?: ServiceOrderPhotoInput[];
      closeDescription: string;
      completedAt?: string;
    }
  | {
      mode: 'RETRIEVAL';
      returnLocationId: string;
      cancelReason?: string;
      photos?: ServiceOrderPhotoInput[];
      closeDescription: string;
      completedAt?: string;
    };

export interface CompleteInstallationResult {
  serviceOrder: ServiceOrderResponse;
  install: {
    status: 'OK' | 'PARTIAL' | 'FAILED';
    timeline: InstallTimelineEvent[];
    pollUrl?: string;
  };
}

export interface ServiceOrderMessageResponse {
  id: string;
  body: string;
  createdAt: string;
  author: { id: string; firstName: string; lastName: string } | null;
}

export interface ServiceOrderAttachmentResponse {
  id: string;
  fileName: string;
  contentType: string | null;
  sizeBytes: number | null;
  createdAt: string;
  createdBy: { id: string; firstName: string; lastName: string } | null;
  /** URL assinada de download (curto TTL). */
  url?: string;
}

export interface AttachmentPresignResponse {
  uploadUrl: string;
  storageKey: string;
  expiresIn: number;
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
  /** Aborta deslocamento/execução e devolve a O.S pra fila (não cancela). */
  returnToQueue(id: string, reason: string) {
    return api.post<ServiceOrderResponse>(
      `/v1/service-orders/${id}/return-to-queue`,
      { reason },
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
  /** Finalização ramificada por tipo de O.S (instalação/suporte/retirada). */
  completeField(id: string, input: CompleteFieldInput) {
    return api.post<{ serviceOrder: ServiceOrderResponse }>(
      `/v1/service-orders/${id}/complete-field`,
      input,
    );
  },
  /** Etapa 1 do one-touch de instalação: provisiona sem fechar a O.S. */
  provisionField(id: string, input: CompleteFieldInput) {
    return api.post<{ serviceOrder: ServiceOrderResponse; install: InstallCustomerResponse }>(
      `/v1/service-orders/${id}/provision-field`,
      input,
    );
  },
  remove(id: string) {
    return api.delete(`/v1/service-orders/${id}`);
  },

  // ── Mensagens (thread) ──────────────────────────────────────────────────
  messagesPath: (id: string) => `/v1/service-orders/${id}/messages`,
  listMessages(id: string) {
    return api.get<ServiceOrderMessageResponse[]>(`/v1/service-orders/${id}/messages`);
  },
  addMessage(id: string, body: string) {
    return api.post<ServiceOrderMessageResponse>(
      `/v1/service-orders/${id}/messages`,
      { body },
    );
  },

  // ── Anexos avulsos ──────────────────────────────────────────────────────
  attachmentsPath: (id: string) => `/v1/service-orders/${id}/attachments`,
  listAttachments(id: string) {
    return api.get<ServiceOrderAttachmentResponse[]>(
      `/v1/service-orders/${id}/attachments`,
    );
  },
  presignAttachment(id: string, fileName: string, contentType?: string) {
    return api.post<AttachmentPresignResponse>(
      `/v1/service-orders/${id}/attachments/presign`,
      { fileName, ...(contentType ? { contentType } : {}) },
    );
  },
  registerAttachment(
    id: string,
    input: {
      storageKey: string;
      fileName: string;
      contentType?: string | null;
      sizeBytes?: number | null;
    },
  ) {
    return api.post<ServiceOrderAttachmentResponse>(
      `/v1/service-orders/${id}/attachments`,
      input,
    );
  },
  removeAttachment(id: string, attachmentId: string) {
    return api.delete(`/v1/service-orders/${id}/attachments/${attachmentId}`);
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
  kind?: ServiceOrderReasonKind;
  order?: number;
}

export interface UpdateServiceOrderReasonInput {
  name?: string;
  description?: string | null;
  isActive?: boolean;
  isInstallation?: boolean;
  kind?: ServiceOrderReasonKind;
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
