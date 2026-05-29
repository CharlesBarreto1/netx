import { z } from 'zod';

/** Schemas Zod do motorista da frota. */

const optionalString = (max: number) =>
  z
    .string()
    .max(max)
    .nullish()
    .transform((v) => (v === '' ? null : (v ?? null)));

export const DriverStatusSchema = z.enum(['ACTIVE', 'INACTIVE']);
export type DriverStatus = z.infer<typeof DriverStatusSchema>;

export const CreateDriverRequestSchema = z.object({
  name: z.string().min(1).max(160),
  document: optionalString(32),
  licenseNumber: optionalString(32),
  licenseCategory: optionalString(8),
  /** ISO 8601 date (YYYY-MM-DD) — base do alerta de vencimento de CNH. */
  licenseExpiry: z.string().date().nullish(),
  phone: optionalString(32),
  status: DriverStatusSchema.default('ACTIVE'),
  /** Vínculo opcional a um usuário do sistema (técnico com login). */
  userId: z.string().uuid().nullish(),
  notes: optionalString(2000),
});
export type CreateDriverRequest = z.infer<typeof CreateDriverRequestSchema>;

export const UpdateDriverRequestSchema = CreateDriverRequestSchema.partial();
export type UpdateDriverRequest = z.infer<typeof UpdateDriverRequestSchema>;

export const ListDriversQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  search: z.string().max(255).optional(),
  status: DriverStatusSchema.optional(),
  sortBy: z.enum(['name', 'createdAt']).default('name'),
  sortDir: z.enum(['asc', 'desc']).default('asc'),
});
export type ListDriversQuery = z.infer<typeof ListDriversQuerySchema>;

export interface DriverResponse {
  id: string;
  tenantId: string;
  name: string;
  document: string | null;
  licenseNumber: string | null;
  licenseCategory: string | null;
  licenseExpiry: string | null;
  phone: string | null;
  status: DriverStatus;
  userId: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}
