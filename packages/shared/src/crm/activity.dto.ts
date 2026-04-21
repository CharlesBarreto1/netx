import { z } from 'zod';

// -----------------------------------------------------------------------------
// Enums (espelho do schema.prisma)
// -----------------------------------------------------------------------------
export const ActivityTypeSchema = z.enum([
  'CALL',
  'MEETING',
  'EMAIL',
  'TASK',
  'WHATSAPP',
  'VISIT',
  'OTHER',
]);
export type ActivityType = z.infer<typeof ActivityTypeSchema>;

export const ActivityStatusSchema = z.enum(['PENDING', 'DONE', 'CANCELLED']);
export type ActivityStatus = z.infer<typeof ActivityStatusSchema>;

// -----------------------------------------------------------------------------
// datetime ISO8601 helper — aceita strings "2026-04-21T14:30:00Z" e afins
// -----------------------------------------------------------------------------
const IsoDateTime = z.string().datetime({ offset: true });

// -----------------------------------------------------------------------------
// Create / Update
// -----------------------------------------------------------------------------
const baseActivityFields = {
  type: ActivityTypeSchema,
  title: z.string().min(1).max(255),
  notes: z.string().max(10_000).nullish(),
  location: z.string().max(255).nullish(),
  durationMin: z.coerce.number().int().min(0).max(60 * 24 * 30).nullish(),
  dueAt: IsoDateTime.nullish(),
  ownerId: z.string().uuid().nullish(),
  dealId: z.string().uuid().nullish(),
  customerId: z.string().uuid().nullish(),
};

export const CreateActivityRequestSchema = z
  .object({ ...baseActivityFields })
  .refine((v) => !!(v.dealId || v.customerId), {
    message: 'Informe ao menos dealId ou customerId',
    path: ['dealId'],
  });
export type CreateActivityRequest = z.infer<typeof CreateActivityRequestSchema>;

export const UpdateActivityRequestSchema = z
  .object({
    type: ActivityTypeSchema.optional(),
    title: z.string().min(1).max(255).optional(),
    notes: z.string().max(10_000).nullish(),
    location: z.string().max(255).nullish(),
    durationMin: z.coerce.number().int().min(0).max(60 * 24 * 30).nullish(),
    dueAt: IsoDateTime.nullish(),
    ownerId: z.string().uuid().nullish(),
  })
  .partial();
export type UpdateActivityRequest = z.infer<typeof UpdateActivityRequestSchema>;

// -----------------------------------------------------------------------------
// Complete / Reopen / Cancel
// -----------------------------------------------------------------------------
export const CompleteActivityRequestSchema = z.object({
  completedAt: IsoDateTime.optional(), // default = now() no backend
  outcome: z.string().max(1000).optional(), // anotação rápida do desfecho
});
export type CompleteActivityRequest = z.infer<typeof CompleteActivityRequestSchema>;

export const CancelActivityRequestSchema = z.object({
  reason: z.string().max(500).optional(),
});
export type CancelActivityRequest = z.infer<typeof CancelActivityRequestSchema>;

// -----------------------------------------------------------------------------
// Listagem / busca
// -----------------------------------------------------------------------------
export const ListActivitiesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),

  dealId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  ownerId: z.string().uuid().optional(),
  type: ActivityTypeSchema.optional(),
  status: ActivityStatusSchema.optional(),

  // Filtros por janela
  dueFrom: IsoDateTime.optional(),
  dueTo: IsoDateTime.optional(),

  // Atalhos de agenda — sobrescrevem dueFrom/dueTo no backend se vierem
  scope: z.enum(['overdue', 'today', 'tomorrow', 'this-week', 'upcoming']).optional(),

  search: z.string().max(255).optional(),

  sortBy: z.enum(['dueAt', 'createdAt', 'updatedAt', 'completedAt']).default('dueAt'),
  sortDir: z.enum(['asc', 'desc']).default('asc'),
});
export type ListActivitiesQuery = z.infer<typeof ListActivitiesQuerySchema>;

// -----------------------------------------------------------------------------
// Response
// -----------------------------------------------------------------------------
export interface ActivityResponse {
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

  // Embeds opcionais
  deal?: { id: string; title: string } | null;
  customer?: { id: string; displayName: string } | null;
  owner?: { id: string; name: string } | null;
  createdBy?: { id: string; name: string } | null;
  completedBy?: { id: string; name: string } | null;
}

// Agenda agrupada por data — útil para a coluna "Próximas atividades"
export interface ActivityAgendaBucket {
  label: 'overdue' | 'today' | 'tomorrow' | 'this-week' | 'later';
  count: number;
  activities: ActivityResponse[];
}
