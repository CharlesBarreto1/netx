import { z } from 'zod';

import { PaymentDetailsSchema, PaymentMethodSchema } from './payment.dto';
import type { PaymentMethod } from './payment.dto';

export const OneTimeChargeStatusSchema = z.enum(['OPEN', 'PAID', 'CANCELLED']);
export type OneTimeChargeStatus = z.infer<typeof OneTimeChargeStatusSchema>;

// =============================================================================
// CRUD
// =============================================================================
export const CreateOneTimeChargeRequestSchema = z.object({
  customerId: z.string().uuid(),
  /** Opcional — vincular a um contrato pra rastreio. */
  contractId: z.string().uuid().nullish(),
  /** Código humano (CB-NNNNNN). Auto-gerado se vazio. */
  code: z.string().max(32).optional(),
  description: z.string().min(1).max(500),
  amount: z.coerce.number().positive().max(1_000_000),
  /** ISO 8601 date (YYYY-MM-DD). */
  dueDate: z.string().date(),
});
export type CreateOneTimeChargeRequest = z.infer<
  typeof CreateOneTimeChargeRequestSchema
>;

export const UpdateOneTimeChargeRequestSchema = z
  .object({
    description: z.string().min(1).max(500).optional(),
    amount: z.coerce.number().positive().max(1_000_000).optional(),
    dueDate: z.string().date().optional(),
    contractId: z.string().uuid().nullish(),
  })
  .strict();
export type UpdateOneTimeChargeRequest = z.infer<
  typeof UpdateOneTimeChargeRequestSchema
>;

// =============================================================================
// PAY / CANCEL
// =============================================================================
export const PayOneTimeChargeRequestSchema = PaymentDetailsSchema;
export type PayOneTimeChargeRequest = z.infer<
  typeof PayOneTimeChargeRequestSchema
>;

export const CancelOneTimeChargeRequestSchema = z.object({
  reason: z.string().max(500).optional(),
});
export type CancelOneTimeChargeRequest = z.infer<
  typeof CancelOneTimeChargeRequestSchema
>;

// =============================================================================
// LIST / FILTROS
// =============================================================================
export const ListOneTimeChargesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),

  customerId: z.string().uuid().optional(),
  contractId: z.string().uuid().optional(),
  cashRegisterId: z.string().uuid().optional(),
  status: OneTimeChargeStatusSchema.optional(),

  dueFrom: z.string().date().optional(),
  dueTo: z.string().date().optional(),

  search: z.string().max(255).optional(),

  sortBy: z.enum(['dueDate', 'createdAt', 'amount']).default('dueDate'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});
export type ListOneTimeChargesQuery = z.infer<
  typeof ListOneTimeChargesQuerySchema
>;

// =============================================================================
// RESPONSE
// =============================================================================
export interface OneTimeChargeResponse {
  id: string;
  tenantId: string;
  customerId: string;
  contractId: string | null;
  code: string | null;
  description: string;
  amount: number;
  dueDate: string;
  issuedAt: string;
  status: OneTimeChargeStatus;

  paidAt: string | null;
  paidAmount: number | null;
  discountAmount: number | null;
  paidVia: PaymentMethod | null;
  cashRegisterId: string | null;
  paymentNote: string | null;

  createdAt: string;
  updatedAt: string;

  // Relations enxutos
  customer?: { id: string; displayName: string } | null;
  contract?: { id: string; code: string | null } | null;
  cashRegister?: { id: string; name: string } | null;
}
