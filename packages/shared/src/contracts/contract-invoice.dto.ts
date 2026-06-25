import { z } from 'zod';

import { PaymentMethodSchema } from '../finance/payment.dto';
import type { PaymentMethod } from '../finance/payment.dto';

export const InvoiceStatusSchema = z.enum(['OPEN', 'PAID', 'OVERDUE', 'CANCELLED']);
export type InvoiceStatus = z.infer<typeof InvoiceStatusSchema>;

// Tipo da fatura. REGULAR = mensalidade do cron; INITIAL = primeira (POSTPAID
// pro-rata ou PREPAID cheia); PRORATION = ajuste positivo de troca de plano;
// CREDIT = nota de crédito (amount negativo). Ver schema.prisma:InvoiceKind.
export const InvoiceKindSchema = z.enum(['REGULAR', 'INITIAL', 'PRORATION', 'CREDIT']);
export type InvoiceKind = z.infer<typeof InvoiceKindSchema>;

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

  // Tipo da fatura — separa cobrança recorrente de ajustes financeiros.
  kind: InvoiceKind;
  // Janela coberta — inclusivo/exclusivo. Nullable pra compat com faturas
  // pré-feature (CREDIT também não tem período).
  periodStart: string | null;  // YYYY-MM-DD
  periodEnd: string | null;    // YYYY-MM-DD

  status: InvoiceStatus;
  paidAt: string | null;
  paidAmount: number | null;
  discountAmount: number | null;
  paidVia: PaymentMethod | null;
  cashRegisterId: string | null;
  paymentNote: string | null;

  reference: string | null;

  // Boleto/Pix de ORIGEM (migração) — quando preenchido, o NetX REIMPRIME o
  // documento já gerado no sistema legado (ex.: Hubsoft) em vez de emitir nova
  // cobrança. O pagamento baixa nos dois sistemas via o sync do legado.
  extSource: string | null; // 'hubsoft' | null
  extBoletoUrl: string | null; // PDF do boleto
  extDigitableLine: string | null; // linha digitável
  extBarcode: string | null; // código de barras
  extPixCode: string | null; // Pix copia-e-cola

  createdAt: string;
  updatedAt: string;

  // Quando incluído em resposta agregada.
  // pppoeUsername é nullable porque contratos IPoE não têm — autenticam por
  // circuit-id/MAC. Pra mostrar o identificador efetivo na UI, prefira o
  // campo `code` (humano) ou puxe o contrato completo via `/contracts/:id`.
  contract?: {
    id: string;
    code: string | null;
    pppoeUsername: string | null;
    customerId: string;
    customerName?: string;
  };
}
