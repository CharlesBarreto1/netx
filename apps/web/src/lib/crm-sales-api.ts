/**
 * Cliente tipado para os endpoints de vendas (pipelines / deals / activities)
 * do core-service. Todas as rotas são proxiadas pelo gateway em `/api/v1/*`.
 *
 * Use com SWR passando a URL como key, ou chame diretamente via `salesApi.*`.
 */
import { api } from './api';
import type {
  Activity,
  ActivityStatus,
  ActivityType,
  Deal,
  DealBoard,
  DealHistoryEntry,
  DealLostReason,
  DealStatus,
  Pipeline,
} from './crm-sales-types';
import type { Paginated } from './crm-types';

// -----------------------------------------------------------------------------
// Helpers — querystring sem libs
// -----------------------------------------------------------------------------
/**
 * Serializa um objeto tipado em querystring. Usa generics (em vez de
 * `Record<string, unknown>`) porque interfaces sem index signature não
 * satisfazem `Record` — o que quebrava o build com TS strict. O cast interno
 * é seguro: iteramos apenas sobre as próprias chaves enumeráveis.
 */
function qs<T extends Record<string, unknown>>(params: T | Record<string, never> = {}): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) {
      v.forEach((item) => usp.append(k, String(item)));
    } else {
      usp.set(k, String(v));
    }
  }
  const s = usp.toString();
  return s ? `?${s}` : '';
}

// =============================================================================
// PIPELINES
// =============================================================================
export interface ListPipelinesParams {
  includeArchived?: boolean;
}

export interface CreatePipelineInput {
  name: string;
  slug: string;
  description?: string | null;
  color?: string | null;
  isDefault?: boolean;
  stages?: Array<{
    name: string;
    probability?: number;
    color?: string | null;
    isWon?: boolean;
    isLost?: boolean;
  }>;
}

export interface UpdatePipelineInput {
  name?: string;
  description?: string | null;
  color?: string | null;
  isDefault?: boolean;
  isArchived?: boolean;
}

export interface CreateStageInput {
  name: string;
  probability?: number;
  color?: string | null;
  isWon?: boolean;
  isLost?: boolean;
}

export interface UpdateStageInput {
  name?: string;
  probability?: number;
  color?: string | null;
  isWon?: boolean;
  isLost?: boolean;
}

export const pipelinesApi = {
  path: (params: ListPipelinesParams = {}) => `/v1/crm/pipelines${qs(params)}`,
  list(params: ListPipelinesParams = {}) {
    return api.get<Pipeline[]>(this.path(params));
  },
  default() {
    return api.get<Pipeline>('/v1/crm/pipelines/default');
  },
  get(id: string) {
    return api.get<Pipeline>(`/v1/crm/pipelines/${id}`);
  },
  create(input: CreatePipelineInput) {
    return api.post<Pipeline>('/v1/crm/pipelines', input);
  },
  update(id: string, input: UpdatePipelineInput) {
    return api.patch<Pipeline>(`/v1/crm/pipelines/${id}`, input);
  },
  remove(id: string) {
    return api.delete(`/v1/crm/pipelines/${id}`);
  },
  addStage(pipelineId: string, input: CreateStageInput) {
    return api.post<Pipeline>(`/v1/crm/pipelines/${pipelineId}/stages`, input);
  },
  updateStage(pipelineId: string, stageId: string, input: UpdateStageInput) {
    return api.patch<Pipeline>(
      `/v1/crm/pipelines/${pipelineId}/stages/${stageId}`,
      input,
    );
  },
  removeStage(pipelineId: string, stageId: string) {
    return api.delete(`/v1/crm/pipelines/${pipelineId}/stages/${stageId}`);
  },
  reorderStages(pipelineId: string, stageIds: string[]) {
    return api.post<Pipeline>(`/v1/crm/pipelines/${pipelineId}/stages/reorder`, {
      stageIds,
    });
  },
};

// =============================================================================
// DEALS
// =============================================================================
export interface ListDealsParams {
  page?: number;
  pageSize?: number;
  pipelineId?: string;
  stageId?: string;
  status?: DealStatus;
  ownerId?: string;
  customerId?: string;
  search?: string;
  expectedCloseFrom?: string; // YYYY-MM-DD
  expectedCloseTo?: string;
  minValue?: number;
  maxValue?: number;
  sortBy?: 'position' | 'value' | 'expectedCloseAt' | 'updatedAt' | 'createdAt';
  sortDir?: 'asc' | 'desc';
}

export interface GetDealsBoardParams {
  pipelineId: string;
  ownerId?: string;
  search?: string;
  perStageLimit?: number;
}

export interface CreateDealInput {
  pipelineId: string;
  stageId?: string;
  title: string;
  description?: string | null;
  value?: number;
  currency?: string;
  probability?: number | null;
  expectedCloseAt?: string | null;
  customerId?: string | null;
  ownerId?: string | null;
}

export type UpdateDealInput = Partial<Omit<CreateDealInput, 'pipelineId' | 'stageId'>>;

export interface MoveDealInput {
  stageId: string;
  position?: number;
  reason?: string;
}

export interface WinDealInput {
  stageId?: string;
  note?: string;
}

export interface LoseDealInput {
  stageId?: string;
  reason: DealLostReason;
  note?: string;
}

export interface ReopenDealInput {
  stageId: string;
}

export const dealsApi = {
  listPath: (params: ListDealsParams = {}) => `/v1/crm/deals${qs(params)}`,
  boardPath: (params: GetDealsBoardParams) => `/v1/crm/deals/board${qs(params)}`,
  getPath: (id: string) => `/v1/crm/deals/${id}`,
  historyPath: (id: string) => `/v1/crm/deals/${id}/history`,

  list(params: ListDealsParams = {}) {
    return api.get<Paginated<Deal>>(this.listPath(params));
  },
  board(params: GetDealsBoardParams) {
    return api.get<DealBoard>(this.boardPath(params));
  },
  get(id: string) {
    return api.get<Deal>(this.getPath(id));
  },
  history(id: string) {
    return api.get<DealHistoryEntry[]>(this.historyPath(id));
  },
  create(input: CreateDealInput) {
    return api.post<Deal>('/v1/crm/deals', input);
  },
  update(id: string, input: UpdateDealInput) {
    return api.patch<Deal>(`/v1/crm/deals/${id}`, input);
  },
  move(id: string, input: MoveDealInput) {
    return api.post<Deal>(`/v1/crm/deals/${id}/move`, input);
  },
  reorderInStage(stageId: string, dealIds: string[]) {
    return api.post<{ ok: true }>('/v1/crm/deals/reorder', { stageId, dealIds });
  },
  win(id: string, input: WinDealInput = {}) {
    return api.post<Deal>(`/v1/crm/deals/${id}/win`, input);
  },
  lose(id: string, input: LoseDealInput) {
    return api.post<Deal>(`/v1/crm/deals/${id}/lose`, input);
  },
  reopen(id: string, input: ReopenDealInput) {
    return api.post<Deal>(`/v1/crm/deals/${id}/reopen`, input);
  },
  remove(id: string) {
    return api.delete(`/v1/crm/deals/${id}`);
  },
};

// =============================================================================
// ACTIVITIES
// =============================================================================
export interface ListActivitiesParams {
  page?: number;
  pageSize?: number;
  dealId?: string;
  customerId?: string;
  ownerId?: string;
  type?: ActivityType;
  status?: ActivityStatus;
  dueFrom?: string; // ISO8601 with offset
  dueTo?: string;
  scope?: 'overdue' | 'today' | 'tomorrow' | 'this-week' | 'upcoming';
  search?: string;
  sortBy?: 'dueAt' | 'createdAt' | 'updatedAt' | 'completedAt';
  sortDir?: 'asc' | 'desc';
}

export interface CreateActivityInput {
  type: ActivityType;
  title: string;
  notes?: string | null;
  location?: string | null;
  durationMin?: number | null;
  dueAt?: string | null;
  ownerId?: string | null;
  dealId?: string | null;
  customerId?: string | null;
}

export type UpdateActivityInput = Partial<Omit<CreateActivityInput, 'dealId' | 'customerId'>>;

export interface CompleteActivityInput {
  completedAt?: string;
  outcome?: string;
}

export interface CancelActivityInput {
  reason?: string;
}

export const activitiesApi = {
  listPath: (params: ListActivitiesParams = {}) => `/v1/crm/activities${qs(params)}`,
  getPath: (id: string) => `/v1/crm/activities/${id}`,

  list(params: ListActivitiesParams = {}) {
    return api.get<Paginated<Activity>>(this.listPath(params));
  },
  get(id: string) {
    return api.get<Activity>(this.getPath(id));
  },
  create(input: CreateActivityInput) {
    return api.post<Activity>('/v1/crm/activities', input);
  },
  update(id: string, input: UpdateActivityInput) {
    return api.patch<Activity>(`/v1/crm/activities/${id}`, input);
  },
  complete(id: string, input: CompleteActivityInput = {}) {
    return api.post<Activity>(`/v1/crm/activities/${id}/complete`, input);
  },
  cancel(id: string, input: CancelActivityInput = {}) {
    return api.post<Activity>(`/v1/crm/activities/${id}/cancel`, input);
  },
  reopen(id: string) {
    return api.post<Activity>(`/v1/crm/activities/${id}/reopen`, {});
  },
  remove(id: string) {
    return api.delete(`/v1/crm/activities/${id}`);
  },
};
