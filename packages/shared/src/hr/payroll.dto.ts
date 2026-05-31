import { z } from 'zod';

import { PaymentMethodSchema } from '../finance/payment.dto';
import type { PaymentMethod } from '../finance/payment.dto';

/**
 * Folha de pagamento — lançamento MANUAL (sem cálculo de INSS/FGTS/IRRF/IPS).
 * Payslip tem linhas (proventos/descontos); o backend soma bruto/desconto/líquido.
 * SalaryPayment registra o pagamento efetivo e integra no caixa (CashMovement
 * OUTCOME, source PAYROLL) — mesmo padrão de FleetExpense.
 */

const optionalString = (max: number) =>
  z
    .string()
    .max(max)
    .nullish()
    .transform((v) => (v === '' ? null : (v ?? null)));

export const PayslipStatusSchema = z.enum([
  'DRAFT',
  'APPROVED',
  'PAID',
  'CANCELLED',
]);
export type PayslipStatus = z.infer<typeof PayslipStatusSchema>;

export const PayslipItemKindSchema = z.enum(['EARNING', 'DEDUCTION']);
export type PayslipItemKind = z.infer<typeof PayslipItemKindSchema>;

export const PayslipItemSchema = z.object({
  kind: PayslipItemKindSchema,
  label: z.string().min(1).max(120),
  amount: z.coerce.number().min(0).max(100_000_000),
});
export type PayslipItem = z.infer<typeof PayslipItemSchema>;

export const CreatePayslipRequestSchema = z.object({
  employeeId: z.string().uuid(),
  /** Competência: YYYY-MM (normalizada pro dia 1 no backend). */
  referenceMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  items: z.array(PayslipItemSchema).max(60).default([]),
  notes: optionalString(1000),
});
export type CreatePayslipRequest = z.infer<typeof CreatePayslipRequestSchema>;

export const UpdatePayslipRequestSchema = z.object({
  items: z.array(PayslipItemSchema).max(60).optional(),
  notes: optionalString(1000),
  storageKey: optionalString(500),
});
export type UpdatePayslipRequest = z.infer<typeof UpdatePayslipRequestSchema>;

export const ListPayslipsQuerySchema = z.object({
  employeeId: z.string().uuid().optional(),
  status: PayslipStatusSchema.optional(),
  /** Filtra por mês YYYY-MM. */
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListPayslipsQuery = z.infer<typeof ListPayslipsQuerySchema>;

export interface PayslipResponse {
  id: string;
  tenantId: string;
  employeeId: string;
  referenceMonth: string; // YYYY-MM-DD (dia 1)
  items: PayslipItem[];
  grossAmount: number;
  deductionsTotal: number;
  netAmount: number;
  status: PayslipStatus;
  notes: string | null;
  storageKey: string | null;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
  employee?: { id: string; fullName: string } | null;
  payment?: SalaryPaymentResponse | null;
  downloadUrl?: string | null;
}

// ── Pagamento ────────────────────────────────────────────────────────────────
// PaymentMethod vem de finance/payment.dto (mesmo enum do schema Prisma).

/**
 * Pagar um holerite. Se `cashRegisterId` presente, lança OUTCOME no caixa.
 * `amount` default = netAmount do holerite (validado no backend).
 */
export const PaySalaryRequestSchema = z.object({
  amount: z.coerce.number().positive().max(100_000_000).optional(),
  paidAt: z.string().datetime({ offset: true }).optional(),
  method: PaymentMethodSchema.default('BANK_TRANSFER'),
  cashRegisterId: z.string().uuid().nullish(),
  receiptStorageKey: optionalString(500),
  notes: optionalString(500),
});
export type PaySalaryRequest = z.infer<typeof PaySalaryRequestSchema>;

export interface SalaryPaymentResponse {
  id: string;
  tenantId: string;
  payslipId: string;
  employeeId: string;
  amount: number;
  paidAt: string;
  method: PaymentMethod;
  cashRegisterId: string | null;
  cashMovementId: string | null;
  receiptStorageKey: string | null;
  notes: string | null;
  createdById: string | null;
  createdAt: string;
  receiptDownloadUrl?: string | null;
}
