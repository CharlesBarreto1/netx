import { z } from 'zod';

import { PaymentMethodSchema } from '../finance/payment.dto';
import type { PaymentMethod } from '../finance/payment.dto';

export const InvoiceStatusSchema = z.enum(['OPEN', 'PAID', 'OVERDUE', 'CANCELLED']);
export type InvoiceStatus = z.infer<typeof InvoiceStatusSchema>;

// -----------------------------------------------------------------------------
// Criação manual (casos excepcionais; o fluxo normal é automático)
// -----------------------------------------------------------------------------
export const CreateContractInvoiceRequestSchema = z.object({
  amount: z.coerce.number().positive().max(1_000_000),
  dueDate: z.string().date(), // YYYY-MM-DD
  reference: z.string().max(120).optional(),
});
export type CreateContractInvoiceRequest = z.infer<typeof CreateContractInvoiceRequestSchema>;

// -----------------------------------------------------------------------------
// Baixa (pagamento) — controle interno, sem gateway
// -----------------------------------------------------------------------------
export const PayContractInvoiceRequestSchema = z.object({
  paidAmount: z.coerce.number().positive().max(1_000_000).optional(),
  paidAt: z.string().datetime().optional(), // default = agora
  note: z.string().max(255).optional(),
  /** Caixa que recebeu. Validado contra membership do user. */
  cashRegisterId: z.string().uuid().nullish(),
  /** Forma de pagamento. */
  paidVia: PaymentMethodSchema.optional(),
  /** Desconto aplicado (positivo). Exige perm `finance.discount.apply`. */
  discountAmount: z.coerce.number().min(0).max(1_000_000).optional(),
});
export type PayContractInvoiceRequest = z.infer<typeof PayContractInvoiceRequestSchema>;

export const CancelContractInvoiceRequestSchema = z.object({
  note: z.string().max(255).optional(),
});
export type CancelContractInvoiceRequest = z.infer<typeof CancelContractInvoiceRequestSchema>;

// -----------------------------------------------------------------------------
// Listagem
// -----------------------------------------------------------------------------
export const ListContractInvoicesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),

  contractId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  status: InvoiceStatusSchema.optional(),

  dueFrom: z.string().date().optional(),
  dueTo: z.string().date().optional(),

  sortBy: z.enum(['dueDate', 'createdAt', 'amount']).default('dueDate'),
  sortDir: z.enum(['asc', 'desc']).default('asc'),
});
export type ListContractInvoicesQuery = z.infer<typeof ListContractInvoicesQuerySchema>;

// -----------------------------------------------------------------------------
// Response
// -----------------------------------------------------------------------------
export interface ContractInvoiceResponse {
  id: string;
  tenantId: string;
  contractId: string;

  amount: number;
  dueDate: string;         // YYYY-MM-DD
  issuedAt: string;

  status: InvoiceStatus;
  paidAt: string | null;
  paidAmount: number | null;
  discountAmount: number | null;
  paidVia: PaymentMethod | null;
  cashRegisterId: string | null;
  paymentNote: string | null;

  reference: string | null;

  createdAt: string;
  updatedAt: string;

  // Quando incluído em resposta agregada.
  contract?: {
    id: string;
    code: string | null;
    pppoeUsername: string;
    customerId: string;
    customerName?: string;
  };
}
