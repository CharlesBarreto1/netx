/**
 * Tipos do CRM de vendas espelhados do `@netx/shared` para consumo no client.
 *
 * Mesmo padrão de `crm-types.ts`: replicamos só o shape TS para evitar importar
 * o Zod como dependência de runtime no bundle do web.
 */

// -----------------------------------------------------------------------------
// Enums
// -----------------------------------------------------------------------------
export type DealStatus = 'OPEN' | 'WON' | 'LOST';

export type DealLostReason =
  | 'PRICE'
  | 'COMPETITOR'
  | 'TIMING'
  | 'NO_BUDGET'
  | 'NO_DECISION'
  | 'NO_RESPONSE'
  | 'OTHER';

export type ActivityType =
  | 'CALL'
  | 'MEETING'
  | 'EMAIL'
  | 'TASK'
  | 'WHATSAPP'
  | 'VISIT'
  | 'OTHER';

export type ActivityStatus = 'PENDING' | 'DONE' | 'CANCELLED';

// -----------------------------------------------------------------------------
// Pipeline
// -----------------------------------------------------------------------------
export interface PipelineStage {
  id: string;
  pipelineId: string;
  name: string;
  order: number;
  probability: number;
  color: string | null;
  isWon: boolean;
  isLost: boolean;
  dealCount?: number;
  dealTotalValue?: number;
  createdAt: string;
  updatedAt: string;
}

export interface Pipeline {
  id: string;
  tenantId: string;
  name: string;
  slug: string;
  description: string | null;
  color: string | null;
  isDefault: boolean;
  isArchived: boolean;
  stages: PipelineStage[];
  createdAt: string;
  updatedAt: string;
}

// -----------------------------------------------------------------------------
// Deal
// -----------------------------------------------------------------------------
export interface DealCustomerLite {
  id: string;
  displayName: string;
  primaryEmail: string | null;
  primaryPhone: string | null;
}

export interface DealOwnerLite {
  id: string;
  name: string;
  email: string;
}

export interface DealStageLite {
  id: string;
  name: string;
  color: string | null;
  isWon: boolean;
  isLost: boolean;
}

export interface Deal {
  id: string;
  tenantId: string;
  pipelineId: string;
  stageId: string;

  title: string;
  description: string | null;
  value: number;
  currency: string;
  probability: number | null;
  expectedCloseAt: string | null;

  status: DealStatus;
  lostReason: DealLostReason | null;
  lostNote: string | null;

  position: number;

  customerId: string | null;
  ownerId: string | null;

  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;

  customer?: DealCustomerLite | null;
  owner?: DealOwnerLite | null;
  stage?: DealStageLite;
  activityCount?: number;
  nextActivityAt?: string | null;
}

export interface DealBoardColumn {
  stage: {
    id: string;
    name: string;
    order: number;
    probability: number;
    color: string | null;
    isWon: boolean;
    isLost: boolean;
  };
  deals: Deal[];
  totalCount: number;
  totalValue: number;
  hasMore: boolean;
}

export interface DealBoard {
  pipelineId: string;
  columns: DealBoardColumn[];
}

export interface DealHistoryEntry {
  id: string;
  dealId: string;
  fromStageId: string | null;
  toStageId: string;
  fromStatus: DealStatus | null;
  toStatus: DealStatus;
  changedById: string | null;
  changedByName: string | null;
  reason: string | null;
  createdAt: string;
}

// -----------------------------------------------------------------------------
// Activity
// -----------------------------------------------------------------------------
export interface ActivityDealLite {
  id: string;
  title: string;
}

export interface ActivityCustomerLite {
  id: string;
  displayName: string;
}

export interface ActivityOwnerLite {
  id: string;
  name: string;
}

export interface Activity {
  id: string;
  tenantId: string;
  type: ActivityType;
  status: ActivityStatus;

  title: string;
  notes: string | null;
  location: string | null;
  durationMin: number | null;

  dueAt: string | null;
  completedAt: string | null;

  dealId: string | null;
  customerId: string | null;
  ownerId: string | null;

  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;

  deal?: ActivityDealLite | null;
  customer?: ActivityCustomerLite | null;
  owner?: ActivityOwnerLite | null;
  createdBy?: ActivityOwnerLite | null;
  completedBy?: ActivityOwnerLite | null;
}

// -----------------------------------------------------------------------------
// Constantes / labels UI
// -----------------------------------------------------------------------------
export const DEAL_STATUSES: DealStatus[] = ['OPEN', 'WON', 'LOST'];

export const DEAL_STATUS_LABEL: Record<DealStatus, string> = {
  OPEN: 'Em aberto',
  WON: 'Ganho',
  LOST: 'Perdido',
};

export const DEAL_LOST_REASONS: DealLostReason[] = [
  'PRICE',
  'COMPETITOR',
  'TIMING',
  'NO_BUDGET',
  'NO_DECISION',
  'NO_RESPONSE',
  'OTHER',
];

export const DEAL_LOST_REASON_LABEL: Record<DealLostReason, string> = {
  PRICE: 'Preço',
  COMPETITOR: 'Concorrente',
  TIMING: 'Momento não é adequado',
  NO_BUDGET: 'Sem orçamento',
  NO_DECISION: 'Sem decisor / indefinição',
  NO_RESPONSE: 'Sem resposta',
  OTHER: 'Outro',
};

export const ACTIVITY_TYPES: ActivityType[] = [
  'CALL',
  'MEETING',
  'EMAIL',
  'TASK',
  'WHATSAPP',
  'VISIT',
  'OTHER',
];

export const ACTIVITY_TYPE_LABEL: Record<ActivityType, string> = {
  CALL: 'Ligação',
  MEETING: 'Reunião',
  EMAIL: 'Email',
  TASK: 'Tarefa',
  WHATSAPP: 'WhatsApp',
  VISIT: 'Visita',
  OTHER: 'Outro',
};

export const ACTIVITY_STATUSES: ActivityStatus[] = ['PENDING', 'DONE', 'CANCELLED'];

export const ACTIVITY_STATUS_LABEL: Record<ActivityStatus, string> = {
  PENDING: 'Pendente',
  DONE: 'Concluída',
  CANCELLED: 'Cancelada',
};
