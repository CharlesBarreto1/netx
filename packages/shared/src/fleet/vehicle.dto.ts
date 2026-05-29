import { z } from 'zod';

/**
 * Schemas Zod do veículo da frota. `trackerUniqueId` é o IMEI/uniqueId do
 * device no Traccar — base da aba "Ao vivo".
 */

const optionalString = (max: number) =>
  z
    .string()
    .max(max)
    .nullish()
    .transform((v) => (v === '' ? null : (v ?? null)));

export const VehicleTypeSchema = z.enum([
  'CAR',
  'MOTORCYCLE',
  'TRUCK',
  'VAN',
  'PICKUP',
  'OTHER',
]);
export type VehicleType = z.infer<typeof VehicleTypeSchema>;

export const VehicleStatusSchema = z.enum(['ACTIVE', 'MAINTENANCE', 'INACTIVE']);
export type VehicleStatus = z.infer<typeof VehicleStatusSchema>;

export const CreateVehicleRequestSchema = z.object({
  plate: z
    .string()
    .min(1)
    .max(16)
    .transform((v) => v.trim().toUpperCase()),
  brand: optionalString(80),
  model: optionalString(80),
  year: z.coerce.number().int().min(1900).max(2100).nullish(),
  type: VehicleTypeSchema.default('CAR'),
  color: optionalString(40),
  renavam: optionalString(32),
  chassis: optionalString(40),
  status: VehicleStatusSchema.default('ACTIVE'),
  trackerUniqueId: optionalString(64),
  odometer: z.coerce.number().int().min(0).default(0),
  notes: optionalString(2000),
  currentDriverId: z.string().uuid().nullish(),
});
export type CreateVehicleRequest = z.infer<typeof CreateVehicleRequestSchema>;

export const UpdateVehicleRequestSchema = CreateVehicleRequestSchema.partial();
export type UpdateVehicleRequest = z.infer<typeof UpdateVehicleRequestSchema>;

export const ListVehiclesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  search: z.string().max(255).optional(),
  status: VehicleStatusSchema.optional(),
  type: VehicleTypeSchema.optional(),
  /** Só veículos com (true) ou sem (false) rastreador. */
  hasTracker: z.coerce.boolean().optional(),
  sortBy: z.enum(['plate', 'createdAt', 'odometer']).default('plate'),
  sortDir: z.enum(['asc', 'desc']).default('asc'),
});
export type ListVehiclesQuery = z.infer<typeof ListVehiclesQuerySchema>;

export interface VehicleResponse {
  id: string;
  tenantId: string;
  plate: string;
  brand: string | null;
  model: string | null;
  year: number | null;
  type: VehicleType;
  color: string | null;
  renavam: string | null;
  chassis: string | null;
  status: VehicleStatus;
  trackerUniqueId: string | null;
  odometer: number;
  notes: string | null;
  currentDriverId: string | null;
  createdAt: string;
  updatedAt: string;

  currentDriver?: { id: string; name: string } | null;
}
