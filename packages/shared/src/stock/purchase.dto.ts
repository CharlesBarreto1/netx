import { z } from 'zod';

/**
 * Purchase — entrada por compra de fornecedor. Operação atômica: cria
 * Purchase, N PurchaseItems, N StockMovements (PURCHASE), atualiza
 * StockLevel (consumíveis) ou cria N SerialItems (patrimoniais), recalcula
 * Product.cost (custo médio ponderado).
 *
 * Validações de negócio (no service):
 *   - Itens não podem ser vazios.
 *   - Pra produto PATRIMONIAL: `serials.length === quantity` (1 serial por unidade).
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
  // Pra PATRIMONIAL: lista de serials, length === quantity.
  // Pra CONSUMIVEL: vazio.
  serials: z.array(z.string().min(1).max(120)).default([]),
  notes: z.string().max(2000).nullish(),
});
export type PurchaseItemInput = z.infer<typeof PurchaseItemInputSchema>;

export const CreatePurchaseRequestSchema = z.object({
  supplierId: z.string().uuid(),
  invoiceNumber: z.string().max(64).nullish(),
  // ISO date. Validamos string mas convertemos pra Date no service.
  date: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  notes: z.string().max(2000).nullish(),
  items: z.array(PurchaseItemInputSchema).min(1, 'Compra precisa de pelo menos 1 item'),
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
