import { z } from 'zod';

// -----------------------------------------------------------------------------
// Enums (espelho do schema.prisma)
// -----------------------------------------------------------------------------
export const DealStatusSchema = z.enum(['OPEN', 'WON', 'LOST']);
export type DealStatus = z.infer<typeof DealStatusSchema>;

export const DealLostReasonSchema = z.enum([
  'PRICE',
  'COMPETITOR',
  'TIMING',
  'NO_BUDGET',
  'NO_DECISION',
  'NO_RESPONSE',
  'OTHER',
]);
export type DealLostReason = z.infer<typeof DealLostReasonSchema>;

// -----------------------------------------------------------------------------
// Create / Update
// -----------------------------------------------------------------------------
const baseDealFields = {
  title: z.string().min(1).max(255),
  description: z.string().max(10_000).nullish(),
  value: z.coerce.number().nonnegative().max(1_000_000_000_000).optional(),
  currency: z.string().length(3).toUpperCase().optional(),
  probability: z.coerce.number().int().min(0).max(100).nullish(),
  expectedCloseAt: z.string().date().nullish(), // YYYY-MM-DD
  customerId: z.string().uuid().nullish(),
  ownerId: z.string().uuid().nullish(),
};

export const CreateDealRequestSchema = z.object({
  pipelineId: z.string().uuid(),
  stageId: z.string().uuid().optional(), // default = primeiro estágio do pipeline
  ...baseDealFields,
});
export type CreateDealRequest = z.infer<typeof CreateDealRequestSchema>;

export const UpdateDealRequestSchema = z
  .object({
    ...baseDealFields,
  })
  .partial();
export type UpdateDealRequest = z.infer<typeof UpdateDealRequestSchema>;

// -----------------------------------------------------------------------------
// Movimentação no Kanban
// -----------------------------------------------------------------------------
export const MoveDealStageRequestSchema = z.object({
  stageId: z.string().uuid(),
  // Posição de inserção dentro da coluna de destino (0-based). Se omitida, vai p/ o topo.
  position: z.coerce.number().int().min(0).optional(),
  reason: z.string().max(500).optional(), // registro no DealHistory
});
export type MoveDealStageRequest = z.infer<typeof MoveDealStageRequestSchema>;

// Reordena deals dentro de uma mesma coluna
export const ReorderDealsRequestSchema = z.object({
  stageId: z.string().uuid(),
  dealIds: z.array(z.string().uuid()).min(1),
});
export type ReorderDealsRequest = z.infer<typeof ReorderDealsRequestSchema>;

// -----------------------------------------------------------------------------
// Fechamento (won/lost)
// -----------------------------------------------------------------------------
export const WinDealRequestSchema = z.object({
  stageId: z.string().uuid().optional(), // se vier, move para estágio isWon específico
  note: z.string().max(1000).optional(),
});
export type WinDealRequest = z.infer<typeof WinDealRequestSchema>;

export const LoseDealRequestSchema = z.object({
  stageId: z.string().uuid().optional(),
  reason: DealLostReasonSchema,
  note: z.string().max(1000).optional(),
});
export type LoseDealRequest = z.infer<typeof LoseDealRequestSchema>;

export const ReopenDealRequestSchema = z.object({
  stageId: z.string().uuid(), // obrigatório: em qual estágio (OPEN) o deal volta
});
export type ReopenDealRequest = z.infer<typeof ReopenDealRequestSchema>;

// -----------------------------------------------------------------------------
// Listagem / busca
// -----------------------------------------------------------------------------
export const ListDealsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),

  pipelineId: z.string().uuid().optional(),
  stageId: z.string().uuid().optional(),
  status: DealStatusSchema.optional(),
  ownerId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),

  search: z.string().max(255).optional(), // título/descrição
  expectedCloseFrom: z.string().date().optional(),
  expectedCloseTo: z.string().date().optional(),
  minValue: z.coerce.number().nonnegative().optional(),
  maxValue: z.coerce.number().nonnegative().optional(),

  sortBy: z.enum(['position', 'value', 'expectedCloseAt', 'updatedAt', 'createdAt']).default('position'),
  sortDir: z.enum(['asc', 'desc']).default('asc'),
});
export type ListDealsQuery = z.infer<typeof ListDealsQuerySchema>;

// Versão "board" (Kanban) — retorna deals agrupados por estágio.
export const GetDealsBoardQuerySchema = z.object({
  pipelineId: z.string().uuid(),
  ownerId: z.string().uuid().optional(),
  search: z.string().max(255).optional(),
  // Para evitar board gigantesco, limita por coluna (o restante fica em "more").
  perStageLimit: z.coerce.number().int().min(1).max(500).default(100),
});
export type GetDealsBoardQuery = z.infer<typeof GetDealsBoardQuerySchema>;

// -----------------------------------------------------------------------------
// Response
// -----------------------------------------------------------------------------
export interface DealResponse {
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

  // Embeds opcionais
  customer?: {
    id: string;
    displayName: string;
    primaryEmail: string | null;
    primaryPhone: string | null;
  } | null;
  owner?: {
    id: string;
    name: string;
    email: string;
  } | null;
  stage?: {
    id: string;
    name: string;
    color: string | null;
    isWon: boolean;
    isLost: boolean;
  };
  activityCount?: number;
  nextActivityAt?: string | null;
}

// Estrutura do board (Kanban)
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
  deals: DealResponse[];
  totalCount: number;
  totalValue: number;
  hasMore: boolean;
}

export interface DealBoardResponse {
  pipelineId: string;
  columns: DealBoardColumn[];
}

// -----------------------------------------------------------------------------
// History
// -----------------------------------------------------------------------------
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
