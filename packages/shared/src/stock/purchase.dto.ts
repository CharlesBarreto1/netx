import { z } from 'zod';

import { PaymentMethodSchema } from '../finance/payment.dto';
import type { PayableStatus } from '../finance/payable.dto';

/**
 * Purchase — entrada por compra de fornecedor. Operação atômica: cria
 * Purchase, N PurchaseItems, N StockMovements (PURCHASE), atualiza
 * StockLevel (consumíveis) ou cria N SerialItems (patrimoniais), recalcula
 * Product.cost (custo médio ponderado).
 *
 * Validações de negócio (no service):
 *   - Itens não podem ser vazios.
 *   - Pra produto PATRIMONIAL: `serials.length <= quantity` (1 serial por
 *     unidade; lançamento PARCIAL é permitido — completa-se depois via
 *     /items/:itemId/serials). O saldo patrimonial reflete só o que já foi
 *     serializado; o total financeiro da NF é sempre quantity * unitCost.
 *   - Pra produto CONSUMIVEL: `serials` deve ser vazio.
 *   - Serials únicos por (tenant, produto) — colisão lança ConflictException.
 *   - User precisa ter acesso (canWrite=true) no `locationId` de cada item.
 */

const decimalStringOrNumber = z
  .union([z.string().regex(/^-?\d+(\.\d{1,4})?$/, 'Valor decimal inválido'), z.number()])
  .transform((v) => Number(v))
  .refine((n) => Number.isFinite(n) && n > 0, 'Deve ser > 0');

export const PurchaseItemInputSchema = z.object({
  productId: z.string().uuid(),
  locationId: z.string().uuid(),
  quantity: decimalStringOrNumber,
  unitCost: decimalStringOrNumber,
  // Pra PATRIMONIAL: lista de serials, length <= quantity (parcial OK).
  // Pra CONSUMIVEL: vazio.
  serials: z.array(z.string().min(1).max(120)).default([]),
  notes: z.string().max(2000).nullish(),
});
export type PurchaseItemInput = z.infer<typeof PurchaseItemInputSchema>;

/**
 * Condição de pagamento da compra → gera as parcelas no contas a pagar:
 *   - CASH (à vista): 1 parcela já PAID na data da compra. `cashRegisterId`
 *     opcional — se informado, lança a saída no caixa na hora.
 *   - INSTALLMENTS (a prazo): N parcelas OPEN; a soma deve bater com o total
 *     da compra (validado no service). Baixa depois em /finance/payables.
 * Campo opcional no payload — sem ele a compra não gera financeiro (compat).
 */
export const PurchasePaymentSchema = z
  .object({
    condition: z.enum(['CASH', 'INSTALLMENTS']),
    // À vista:
    cashRegisterId: z.string().uuid().nullish(),
    paidVia: PaymentMethodSchema.optional(),
    // A prazo:
    installments: z
      .array(
        z.object({
          dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          amount: decimalStringOrNumber,
        }),
      )
      .max(60)
      .optional(),
  })
  .superRefine((v, ctx) => {
    if (v.condition === 'INSTALLMENTS' && (!v.installments || v.installments.length === 0)) {
      ctx.addIssue({
        code: 'custom',
        path: ['installments'],
        message: 'Compra a prazo precisa de pelo menos 1 parcela',
      });
    }
    if (v.condition === 'CASH' && v.installments && v.installments.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['installments'],
        message: 'Compra à vista não leva parcelas',
      });
    }
  });
export type PurchasePayment = z.infer<typeof PurchasePaymentSchema>;

export const CreatePurchaseRequestSchema = z.object({
  supplierId: z.string().uuid(),
  invoiceNumber: z.string().max(64).nullish(),
  // ISO date. Validamos string mas convertemos pra Date no service.
  date: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  notes: z.string().max(2000).nullish(),
  items: z.array(PurchaseItemInputSchema).min(1, 'Compra precisa de pelo menos 1 item'),
  payment: PurchasePaymentSchema.nullish(),
});
export type CreatePurchaseRequest = z.infer<typeof CreatePurchaseRequestSchema>;

/**
 * Edição de compra — semântica de REPLACE total: o service reverte os efeitos
 * da compra original (mesmas travas do delete: nada pode ter sido movimentado)
 * e reaplica os itens novos numa única transação. Por isso o payload é igual
 * ao de criação.
 */
export const UpdatePurchaseRequestSchema = CreatePurchaseRequestSchema;
export type UpdatePurchaseRequest = z.infer<typeof UpdatePurchaseRequestSchema>;

/**
 * Entrada INCREMENTAL de seriais numa linha de compra PATRIMONIAL já lançada —
 * o operador digita/escaneia em lotes até completar a quantidade. Cada serial
 * vira um SerialItem + movimento de kardex na hora. Validações no service:
 * produto PATRIMONIAL, `count_atual + novos <= quantity`, únicos no payload e
 * sem colisão no DB, e o user precisa ter acesso de escrita no local da linha.
 */
export const AddPurchaseSerialsRequestSchema = z.object({
  serials: z
    .array(z.string().trim().min(1).max(120))
    .min(1, 'Informe pelo menos 1 serial')
    .max(2000, 'Máximo de 2000 seriais por lote'),
});
export type AddPurchaseSerialsRequest = z.infer<typeof AddPurchaseSerialsRequestSchema>;

/** Um serial de uma linha de compra, com o necessário pra renomear/remover. */
export interface PurchaseItemSerialResponse {
  /** id do SerialItem (pra rename/remoção). */
  id: string;
  serial: string;
  status: 'IN_STOCK' | 'ALLOCATED' | 'IN_TRANSIT' | 'DEFECTIVE' | 'WRITTEN_OFF' | 'SOLD' | 'DISCARDED';
  locationName: string | null;
  /** Código do contrato se em comodato (pra avisar que não dá pra remover). */
  contractCode: string | null;
}

export interface PurchaseResponse {
  id: string;
  tenantId: string;
  supplierId: string;
  supplierName?: string;
  invoiceNumber: string | null;
  date: string;
  totalCost: string;
  notes: string | null;
  createdById: string;
  createdByName?: string;
  createdAt: string;
  // Última edição (null/undefined = nunca editada). Trilha completa no AuditLog.
  updatedById?: string | null;
  updatedByName?: string | null;
  updatedAt?: string;
  // Parcelas do contas a pagar geradas pela compra (vazio = sem financeiro).
  payables?: Array<{
    id: string;
    installmentNumber: number;
    installmentCount: number;
    amount: string;
    dueDate: string;
    status: PayableStatus;
    paidAt: string | null;
    paidVia: string | null;
    cashRegisterId: string | null;
  }>;
  items: Array<{
    id: string;
    productId: string;
    productName?: string;
    productSku?: string;
    productType?: 'PATRIMONIAL' | 'CONSUMIVEL';
    locationId: string;
    locationName?: string;
    quantity: string;
    unitCost: string;
    totalCost: string;
    serials: string[];
    notes: string | null;
  }>;
}
