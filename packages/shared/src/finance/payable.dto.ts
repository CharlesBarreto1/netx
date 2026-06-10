import { z } from 'zod';

import { PaymentMethodSchema, type PaymentMethod } from './payment.dto';

/**
 * SupplierPayable — conta a pagar (parcela de pagamento a fornecedor).
 *
 * Hoje toda parcela nasce do lançamento de compra de estoque:
 *   - à vista (CASH): 1 parcela já PAID na data da compra (com ou sem caixa);
 *   - a prazo (INSTALLMENTS): N parcelas OPEN com vencimentos.
 *
 * "Vencida" é derivada (status OPEN + dueDate < hoje) — não existe status
 * OVERDUE persistido nem cron. A baixa (pay) registra CashMovement OUTCOME
 * (source SUPPLIER_PAYABLE) quando um caixa é informado.
 */

export const PayableStatusSchema = z.enum(['OPEN', 'PAID', 'CANCELLED']);
export type PayableStatus = z.infer<typeof PayableStatusSchema>;

// =============================================================================
// LIST
// =============================================================================
export const ListPayablesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),

  supplierId: z.string().uuid().optional(),
  purchaseId: z.string().uuid().optional(),
  status: PayableStatusSchema.optional(),
  /** Só parcelas vencidas (OPEN + dueDate < hoje). Ignora `status`. */
  overdueOnly: z.coerce.boolean().optional(),

  dueFrom: z.string().date().optional(),
  dueTo: z.string().date().optional(),

  search: z.string().max(255).optional(),

  sortBy: z.enum(['dueDate', 'createdAt', 'amount']).default('dueDate'),
  sortDir: z.enum(['asc', 'desc']).default('asc'),
});
export type ListPayablesQuery = z.infer<typeof ListPayablesQuerySchema>;

// =============================================================================
// PAY — baixa de parcela. Sem desconto (preço de fornecedor já é o negociado);
// se precisar, ajusta o paidAmount direto.
// =============================================================================
export const PaySupplierPayableRequestSchema = z.object({
  /** Caixa que pagou. Se vazio, registra a baixa "sem caixa" (sem movimento). */
  cashRegisterId: z.string().uuid().nullish(),
  paidVia: PaymentMethodSchema.optional(),
  /** Valor efetivamente pago. Default = amount da parcela. */
  paidAmount: z.coerce.number().positive().optional(),
  /** Override da data — default = now. */
  paidAt: z.string().datetime({ offset: true }).optional(),
  note: z.string().max(500).optional(),
});
export type PaySupplierPayableRequest = z.infer<
  typeof PaySupplierPayableRequestSchema
>;

// =============================================================================
// RESPONSE
// =============================================================================
export interface SupplierPayableResponse {
  id: string;
  tenantId: string;
  supplierId: string;
  supplierName?: string;
  purchaseId: string | null;
  /** NF da compra de origem (denormalizada pra listagem). */
  purchaseInvoiceNumber?: string | null;
  description: string | null;
  installmentNumber: number;
  installmentCount: number;
  amount: number;
  dueDate: string; // YYYY-MM-DD
  status: PayableStatus;
  /** Derivado: status OPEN + dueDate < hoje. */
  isOverdue: boolean;

  paidAt: string | null;
  paidAmount: number | null;
  paidVia: PaymentMethod | null;
  cashRegisterId: string | null;
  cashRegisterName?: string | null;
  paymentNote: string | null;

  createdById: string;
  createdByName?: string;
  createdAt: string;
  updatedAt: string;
}

/** Totais da listagem (pro cabeçalho da tela de contas a pagar). */
export interface PayablesSummary {
  openCount: number;
  openTotal: number;
  overdueCount: number;
  overdueTotal: number;
  paidThisMonthTotal: number;
}
