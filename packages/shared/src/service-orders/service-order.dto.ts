import { z } from 'zod';

/**
 * Status persistido no DB. `OVERDUE` NÃO é persistido — é um status derivado
 * computado no momento do read quando `scheduledAt < now AND status ∈
 * {OPEN, SCHEDULED}`. Por isso o enum aqui só tem 5 valores; `displayStatus`
 * na resposta pode adicionar OVERDUE.
 */
export const ServiceOrderStatusSchema = z.enum([
  'OPEN',
  'SCHEDULED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
]);
export type ServiceOrderStatus = z.infer<typeof ServiceOrderStatusSchema>;

/** Status visual exposto pro frontend (inclui OVERDUE derivado). */
export const ServiceOrderDisplayStatusSchema = z.enum([
  'OPEN',
  'SCHEDULED',
  'IN_PROGRESS',
  'OVERDUE',
  'COMPLETED',
  'CANCELLED',
]);
export type ServiceOrderDisplayStatus = z.infer<
  typeof ServiceOrderDisplayStatusSchema
>;

// =============================================================================
// CREATE
// =============================================================================
export const CreateServiceOrderRequestSchema = z.object({
  contractId: z.string().uuid(),
  reasonId: z.string().uuid(),
  /** Código humano opcional. Se vazio, gerado pelo service (OS-000123). */
  code: z.string().max(32).optional(),
  /** ISO 8601. Se vazio, OS nasce sem agendamento (status OPEN). */
  scheduledAt: z.string().datetime({ offset: true }).nullish(),
  openDescription: z.string().min(1).max(10_000),
  /** Cidade/estado denormalizados — se vazios, o backend tenta puxar do
   *  endereço primário do customer do contrato. */
  city: z.string().max(120).nullish(),
  state: z.string().max(120).nullish(),
  /** UUID do user atribuído (técnico). Opcional. */
  assignedToId: z.string().uuid().nullish(),
});
export type CreateServiceOrderRequest = z.infer<
  typeof CreateServiceOrderRequestSchema
>;

// =============================================================================
// UPDATE (campos editáveis a qualquer momento; transições de status têm rotas
// próprias /start /complete /cancel)
// =============================================================================
export const UpdateServiceOrderRequestSchema = z.object({
  reasonId: z.string().uuid().optional(),
  scheduledAt: z.string().datetime({ offset: true }).nullish(),
  openDescription: z.string().min(1).max(10_000).optional(),
  closeDescription: z.string().max(10_000).nullish(),
  city: z.string().max(120).nullish(),
  state: z.string().max(120).nullish(),
  assignedToId: z.string().uuid().nullish(),
});
export type UpdateServiceOrderRequest = z.infer<
  typeof UpdateServiceOrderRequestSchema
>;

// =============================================================================
// TRANSIÇÕES DE STATUS
// =============================================================================
/** Marca como IN_PROGRESS. Setamos startedAt. */
export const StartServiceOrderRequestSchema = z.object({
  startedAt: z.string().datetime({ offset: true }).optional(),
});
export type StartServiceOrderRequest = z.infer<
  typeof StartServiceOrderRequestSchema
>;

/**
 * Marca como COMPLETED. closeDescription obrigatória — é o que vai pro
 * histórico do cliente.
 */
export const CompleteServiceOrderRequestSchema = z.object({
  closeDescription: z.string().min(1).max(10_000),
  completedAt: z.string().datetime({ offset: true }).optional(),
});
export type CompleteServiceOrderRequest = z.infer<
  typeof CompleteServiceOrderRequestSchema
>;

export const CancelServiceOrderRequestSchema = z.object({
  /** Motivo do cancelamento (opcional, vai pra audit log). */
  reason: z.string().max(500).optional(),
});
export type CancelServiceOrderRequest = z.infer<
  typeof CancelServiceOrderRequestSchema
>;

// =============================================================================
// LIST / FILTROS
// =============================================================================
export const ListServiceOrdersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),

  contractId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  reasonId: z.string().uuid().optional(),
  assignedToId: z.string().uuid().optional(),

  /**
   * Filtro por status. Aceita os status persistidos OU o derivado OVERDUE.
   * Quando OVERDUE, o backend faz: scheduledAt < now AND status ∈ {OPEN,
   * SCHEDULED}.
   */
  status: ServiceOrderDisplayStatusSchema.optional(),

  /** Cidade — filtro contains (case-insensitive). */
  city: z.string().max(120).optional(),

  /** Range do scheduledAt (ISO 8601). */
  scheduledFrom: z.string().datetime({ offset: true }).optional(),
  scheduledTo: z.string().datetime({ offset: true }).optional(),

  /** Busca livre (code / openDescription). */
  search: z.string().max(255).optional(),

  sortBy: z
    .enum(['scheduledAt', 'openedAt', 'createdAt', 'updatedAt'])
    .default('openedAt'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});
export type ListServiceOrdersQuery = z.infer<typeof ListServiceOrdersQuerySchema>;

// =============================================================================
// RESPONSE
// =============================================================================
export interface ServiceOrderResponse {
  id: string;
  tenantId: string;
  contractId: string;
  reasonId: string;
  code: string | null;

  /** Status persistido no banco. */
  status: ServiceOrderStatus;
  /**
   * Status para exibição (igual ao `status`, exceto quando vencido —
   * `displayStatus` vira OVERDUE pra UI mostrar em vermelho sem precisar
   * recomputar).
   */
  displayStatus: ServiceOrderDisplayStatus;

  openedAt: string;
  scheduledAt: string | null;
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

  // Relations enxutos pra UI:
  reason?: { id: string; name: string } | null;
  contract?: {
    id: string;
    code: string | null;
    pppoeUsername: string;
    customerId: string;
  } | null;
  customer?: { id: string; displayName: string } | null;
  assignedTo?: { id: string; firstName: string; lastName: string } | null;
}
