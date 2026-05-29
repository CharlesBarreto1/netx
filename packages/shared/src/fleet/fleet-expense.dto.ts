import { z } from 'zod';

/**
 * Despesa de frota. Quando `cashRegisterId` é informado, o backend lança um
 * movimento OUTCOME (source FLEET_EXPENSE) no caixa — integrando ao financeiro
 * global. `cashMovementId` na resposta aponta pro movimento gerado.
 */

const optionalString = (max: number) =>
  z
    .string()
    .max(max)
    .nullish()
    .transform((v) => (v === '' ? null : (v ?? null)));

export const FleetExpenseTypeSchema = z.enum([
  'FUEL',
  'TOLL',
  'FINE',
  'INSURANCE',
  'REPAIR',
  'TAX',
  'OTHER',
]);
export type FleetExpenseType = z.infer<typeof FleetExpenseTypeSchema>;

export const CreateFleetExpenseRequestSchema = z.object({
  vehicleId: z.string().uuid(),
  driverId: z.string().uuid().nullish(),
  type: FleetExpenseTypeSchema.default('FUEL'),
  amount: z.coerce.number().positive().max(10_000_000),
  occurredAt: z.string().datetime({ offset: true }),
  odometer: z.coerce.number().int().min(0).nullish(),
  description: optionalString(500),
  /** Caixa que pagou. Se presente, gera um OUTCOME no financeiro. */
  cashRegisterId: z.string().uuid().nullish(),
});
export type CreateFleetExpenseRequest = z.infer<
  typeof CreateFleetExpenseRequestSchema
>;

export const UpdateFleetExpenseRequestSchema =
  CreateFleetExpenseRequestSchema.partial();
export type UpdateFleetExpenseRequest = z.infer<
  typeof UpdateFleetExpenseRequestSchema
>;

export const ListFleetExpensesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  vehicleId: z.string().uuid().optional(),
  driverId: z.string().uuid().optional(),
  type: FleetExpenseTypeSchema.optional(),
  cashRegisterId: z.string().uuid().optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  search: z.string().max(255).optional(),
  sortBy: z.enum(['occurredAt', 'amount', 'createdAt']).default('occurredAt'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});
export type ListFleetExpensesQuery = z.infer<
  typeof ListFleetExpensesQuerySchema
>;

export interface FleetExpenseResponse {
  id: string;
  tenantId: string;
  vehicleId: string;
  driverId: string | null;
  type: FleetExpenseType;
  amount: number;
  occurredAt: string;
  odometer: number | null;
  description: string | null;
  cashRegisterId: string | null;
  cashMovementId: string | null;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;

  vehicle?: { id: string; plate: string } | null;
  driver?: { id: string; name: string } | null;
  cashRegister?: { id: string; name: string } | null;
}
