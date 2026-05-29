import { z } from 'zod';

/**
 * Manutenção da frota:
 *  - MaintenancePlan: preventiva. Define intervalo (km e/ou dias) e o backend
 *    calcula o próximo vencimento (nextDue*) + um `dueStatus` derivado pra
 *    alertar "carro X precisa trocar óleo / revisão próxima".
 *  - MaintenanceRecord: manutenção executada. Avança o marco do plano. Custo é
 *    informativo — saída de caixa real vai como FleetExpense (REPAIR).
 */

const optionalString = (max: number) =>
  z
    .string()
    .max(max)
    .nullish()
    .transform((v) => (v === '' ? null : (v ?? null)));

export const MaintenanceKindSchema = z.enum([
  'OIL_CHANGE',
  'REVISION',
  'TIRES',
  'BRAKES',
  'FILTERS',
  'ALIGNMENT',
  'OTHER',
]);
export type MaintenanceKind = z.infer<typeof MaintenanceKindSchema>;

/** Situação do plano relativa ao vencimento. */
export const MaintenanceDueStatusSchema = z.enum([
  'OK',
  'DUE_SOON',
  'OVERDUE',
  'UNKNOWN',
]);
export type MaintenanceDueStatus = z.infer<typeof MaintenanceDueStatusSchema>;

// =============================================================================
// PLANS (preventiva)
// =============================================================================
export const CreateMaintenancePlanRequestSchema = z
  .object({
    vehicleId: z.string().uuid(),
    kind: MaintenanceKindSchema.default('OIL_CHANGE'),
    description: optionalString(255),
    intervalKm: z.coerce.number().int().positive().max(1_000_000).nullish(),
    intervalDays: z.coerce.number().int().positive().max(36_500).nullish(),
    lastServiceOdometer: z.coerce.number().int().min(0).nullish(),
    /** ISO 8601 date (YYYY-MM-DD). */
    lastServiceDate: z.string().date().nullish(),
    active: z.coerce.boolean().default(true),
  })
  .refine((v) => v.intervalKm != null || v.intervalDays != null, {
    message: 'Informe ao menos um intervalo (km ou dias).',
    path: ['intervalKm'],
  });
export type CreateMaintenancePlanRequest = z.infer<
  typeof CreateMaintenancePlanRequestSchema
>;

// Sem o refine no update (campos podem vir isolados); a regra de "ao menos um
// intervalo" é revalidada no service contra o estado persistido.
export const UpdateMaintenancePlanRequestSchema = z
  .object({
    kind: MaintenanceKindSchema.optional(),
    description: optionalString(255),
    intervalKm: z.coerce.number().int().positive().max(1_000_000).nullish(),
    intervalDays: z.coerce.number().int().positive().max(36_500).nullish(),
    lastServiceOdometer: z.coerce.number().int().min(0).nullish(),
    lastServiceDate: z.string().date().nullish(),
    active: z.coerce.boolean().optional(),
  })
  .strict();
export type UpdateMaintenancePlanRequest = z.infer<
  typeof UpdateMaintenancePlanRequestSchema
>;

export const ListMaintenancePlansQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  vehicleId: z.string().uuid().optional(),
  active: z.coerce.boolean().optional(),
  /** Só planos com alerta (DUE_SOON ou OVERDUE). */
  dueOnly: z.coerce.boolean().optional(),
  sortBy: z.enum(['nextDueDate', 'createdAt']).default('nextDueDate'),
  sortDir: z.enum(['asc', 'desc']).default('asc'),
});
export type ListMaintenancePlansQuery = z.infer<
  typeof ListMaintenancePlansQuerySchema
>;

export interface MaintenancePlanResponse {
  id: string;
  tenantId: string;
  vehicleId: string;
  kind: MaintenanceKind;
  description: string | null;
  intervalKm: number | null;
  intervalDays: number | null;
  lastServiceOdometer: number | null;
  lastServiceDate: string | null;
  nextDueOdometer: number | null;
  nextDueDate: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;

  // Derivados (calculados no service vs. odômetro atual do veículo + hoje).
  dueStatus: MaintenanceDueStatus;
  kmRemaining: number | null;
  daysRemaining: number | null;

  vehicle?: { id: string; plate: string; odometer: number } | null;
}

// =============================================================================
// RECORDS (executada)
// =============================================================================
export const CreateMaintenanceRecordRequestSchema = z.object({
  vehicleId: z.string().uuid(),
  /** Opcional — vincular a um plano preventivo pra avançar o marco. */
  planId: z.string().uuid().nullish(),
  kind: MaintenanceKindSchema.default('OIL_CHANGE'),
  /** ISO 8601 date (YYYY-MM-DD). */
  performedAt: z.string().date(),
  odometer: z.coerce.number().int().min(0).nullish(),
  cost: z.coerce.number().min(0).max(10_000_000).nullish(),
  workshop: optionalString(160),
  description: optionalString(500),
});
export type CreateMaintenanceRecordRequest = z.infer<
  typeof CreateMaintenanceRecordRequestSchema
>;

export const ListMaintenanceRecordsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  vehicleId: z.string().uuid().optional(),
  planId: z.string().uuid().optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  sortBy: z.enum(['performedAt', 'createdAt']).default('performedAt'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});
export type ListMaintenanceRecordsQuery = z.infer<
  typeof ListMaintenanceRecordsQuerySchema
>;

export interface MaintenanceRecordResponse {
  id: string;
  tenantId: string;
  vehicleId: string;
  planId: string | null;
  kind: MaintenanceKind;
  performedAt: string;
  odometer: number | null;
  cost: number | null;
  workshop: string | null;
  description: string | null;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;

  vehicle?: { id: string; plate: string } | null;
}
