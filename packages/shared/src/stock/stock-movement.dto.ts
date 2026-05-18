import { z } from 'zod';

/**
 * StockMovement — kardex consulta. Movimentos são criados PELO sistema através
 * de operações de negócio (Purchase, Sale, Comodato, OS, ajustes). Não há
 * endpoint público de "criar movimento avulso" — usa endpoints dedicados:
 *   POST /v1/stock/adjustments  — ajuste de inventário (entrada/saída livre)
 *   POST /v1/stock/transfers    — transferência entre locais
 *
 * Listing query padrão.
 */

export const MovementTypeSchema = z.enum([
  'PURCHASE',
  'PURCHASE_RETURN',
  'SALE',
  'SALE_RETURN',
  'COMODATO_OUT',
  'COMODATO_RETURN',
  'OS_CONSUMPTION',
  'ADJUSTMENT_IN',
  'ADJUSTMENT_OUT',
  'TRANSFER_OUT',
  'TRANSFER_IN',
]);
export type MovementType = z.infer<typeof MovementTypeSchema>;

export const ListStockMovementsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  productId: z.string().uuid().nullish(),
  serialItemId: z.string().uuid().nullish(),
  locationId: z.string().uuid().nullish(),
  type: MovementTypeSchema.nullish(),
  dateFrom: z.string().datetime().nullish(),
  dateTo: z.string().datetime().nullish(),
});
export type ListStockMovementsQuery = z.infer<typeof ListStockMovementsQuerySchema>;

// Ajuste de inventário — entrada/saída livre, sem fornecedor/cliente.
// Usado pra: contagem física, descarte, perdas, achados.
const decimalPositive = z
  .union([z.string().regex(/^\d+(\.\d{1,4})?$/), z.number()])
  .transform((v) => Number(v))
  .refine((n) => Number.isFinite(n) && n > 0, 'Deve ser > 0');

export const CreateAdjustmentRequestSchema = z.object({
  // Direção do ajuste.
  direction: z.enum(['IN', 'OUT']),
  productId: z.string().uuid(),
  locationId: z.string().uuid(),
  quantity: decimalPositive,
  // unitCost só pra entradas; saídas usam Product.cost (custo médio).
  unitCost: decimalPositive.optional(),
  // Pra PATRIMONIAL: serials (criados pra IN, marcados pra OUT).
  serials: z.array(z.string().min(1).max(120)).default([]),
  reason: z.string().min(1).max(255),
  notes: z.string().max(2000).nullish(),
});
export type CreateAdjustmentRequest = z.infer<typeof CreateAdjustmentRequestSchema>;

// Transferência entre locais — gera PAR de movimentos (TRANSFER_OUT + TRANSFER_IN).
export const CreateTransferRequestSchema = z.object({
  productId: z.string().uuid(),
  fromLocationId: z.string().uuid(),
  toLocationId: z.string().uuid(),
  quantity: decimalPositive,
  // Pra PATRIMONIAL: lista de serialItemIds que mudam de local.
  serialItemIds: z.array(z.string().uuid()).default([]),
  notes: z.string().max(2000).nullish(),
}).refine(
  (data) => data.fromLocationId !== data.toLocationId,
  { message: 'fromLocationId e toLocationId devem ser diferentes', path: ['toLocationId'] },
);
export type CreateTransferRequest = z.infer<typeof CreateTransferRequestSchema>;

export interface StockMovementResponse {
  id: string;
  type: MovementType;
  productId: string;
  productName?: string;
  serialItemId: string | null;
  serial?: string | null;
  fromLocationId: string | null;
  fromLocationName?: string | null;
  toLocationId: string | null;
  toLocationName?: string | null;
  quantity: string;
  unitCost: string;
  totalCost: string;
  purchaseId: string | null;
  notes: string | null;
  createdById: string;
  createdByName?: string;
  createdAt: string;
}
