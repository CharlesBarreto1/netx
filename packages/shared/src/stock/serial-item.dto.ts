/**
 * DTOs de gestão de patrimônios (SerialItem) — listagem com busca por serial e
 * mudança de status (defeito/baixa/venda/inutilização + reativação).
 *
 * Status de saída (DEFECTIVE/WRITTEN_OFF/SOLD/DISCARDED) descontabilizam o item
 * do estoque (o saldo de PATRIMONIAL conta só IN_STOCK), mas o registro
 * permanece pra controle e relatórios. Reativar (→ IN_STOCK) recontabiliza.
 */
import { z } from 'zod';

import { PaginationQuerySchema } from '../pagination';

export const SerialStatusSchema = z.enum([
  'IN_STOCK',
  'ALLOCATED',
  'IN_TRANSIT',
  'DEFECTIVE',
  'WRITTEN_OFF',
  'SOLD',
  'DISCARDED',
]);
export type SerialStatus = z.infer<typeof SerialStatusSchema>;

/** Status que o operador pode aplicar pela tela de patrimônios. */
export const SerialStatusTargetSchema = z.enum([
  'IN_STOCK', // reativar (voltar ao estoque)
  'DEFECTIVE',
  'WRITTEN_OFF',
  'SOLD',
  'DISCARDED',
]);
export type SerialStatusTarget = z.infer<typeof SerialStatusTargetSchema>;

export const ListSerialItemsQuerySchema = PaginationQuerySchema.extend({
  /** Busca por serial (contains, case-insensitive). */
  search: z.string().max(120).optional(),
  status: SerialStatusSchema.optional(),
  productId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),
});
export type ListSerialItemsQuery = z.infer<typeof ListSerialItemsQuerySchema>;

export const ChangeSerialStatusRequestSchema = z
  .object({
    status: SerialStatusTargetSchema,
    /** Motivo (vai pro kardex/notes/audit). Recomendado. */
    reason: z.string().max(500).optional(),
    /** Obrigatório quando status = IN_STOCK (pra onde o item volta). */
    locationId: z.string().uuid().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.status === 'IN_STOCK' && !val.locationId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['locationId'],
        message: 'Informe o local pra onde o item volta.',
      });
    }
  });
export type ChangeSerialStatusRequest = z.infer<typeof ChangeSerialStatusRequestSchema>;

/**
 * Corrige o serial (identificador) de um patrimônio lançado com erro de
 * digitação. Não movimenta estoque — só renomeia — então é permitido mesmo com
 * o item já em comodato/contrato. Valida colisão com outro serial do mesmo
 * produto no service.
 */
export const RenameSerialRequestSchema = z.object({
  serial: z.string().trim().min(1, 'Serial obrigatório').max(120),
});
export type RenameSerialRequest = z.infer<typeof RenameSerialRequestSchema>;

// ---------------------------------------------------------------------------
// RELATÓRIO de estoque/patrimônio (agregados + detalhe + export)
// ---------------------------------------------------------------------------
export const StockReportQuerySchema = z.object({
  locationId: z.string().uuid().optional(),
  productId: z.string().uuid().optional(),
  status: SerialStatusSchema.optional(),
  /** Cidade do cliente (comodato), contains case-insensitive. */
  city: z.string().max(120).optional(),
  /** Só itens em comodato (ALLOCATED). */
  onlyComodato: z.coerce.boolean().optional(),
  /** Busca por serial. */
  search: z.string().max(120).optional(),
  /** Período de aquisição (data de compra). Aceita YYYY-MM-DD ou ISO. */
  acquiredFrom: z.string().max(30).optional(),
  acquiredTo: z.string().max(30).optional(),
});
export type StockReportQuery = z.infer<typeof StockReportQuerySchema>;

export interface StockReportItem {
  id: string;
  serial: string;
  status: SerialStatus;
  productSku: string;
  productName: string;
  locationName: string | null;
  contractCode: string | null;
  customerName: string | null;
  city: string | null;
  /** Valor de compra unitário (acquisitionCost, fallback custo do produto). */
  purchaseValue: number;
}

export interface StockReportResponse {
  summary: { totalUnits: number; totalPurchaseValue: number };
  byProduct: Array<{
    productId: string;
    sku: string;
    name: string;
    units: number;
    purchaseValue: number;
  }>;
  byStatus: Array<{ status: SerialStatus; units: number; purchaseValue: number }>;
  /** Total por cidade do cliente (null = sem cidade / parado em depósito). */
  byCity: Array<{ city: string | null; units: number; purchaseValue: number }>;
  items: StockReportItem[];
  /** true se atingiu o teto de linhas (refine os filtros). */
  truncated: boolean;
}

// ---------------------------------------------------------------------------
// HISTÓRICO do equipamento (timeline a partir do kardex)
// ---------------------------------------------------------------------------
export type SerialHistoryEventType =
  | 'PURCHASE'
  | 'PURCHASE_RETURN'
  | 'TRANSFER'
  | 'COMODATO_OUT'
  | 'COMODATO_RETURN'
  | 'OS_CONSUMPTION'
  | 'ADJUSTMENT_IN'
  | 'ADJUSTMENT_OUT'
  | 'SALE'
  | 'SALE_RETURN';

export interface SerialHistoryEvent {
  id: string;
  type: SerialHistoryEventType;
  date: string;
  /** Nome do usuário que fez a operação. */
  user: string | null;
  fromLocation: string | null;
  toLocation: string | null;
  supplier: string | null;
  /** Número da NF/fatura (compra). */
  invoiceNumber: string | null;
  contractCode: string | null;
  customerName: string | null;
  notes: string | null;
}

export interface SerialHistoryResponse {
  serial: string;
  product: { sku: string; name: string };
  status: SerialStatus;
  events: SerialHistoryEvent[];
}

export interface SerialItemResponse {
  id: string;
  serial: string;
  status: SerialStatus;
  product: { id: string; sku: string; name: string; brand: string | null; model: string | null };
  location: { id: string; name: string } | null;
  contract: { id: string; code: string | null } | null;
  acquisitionCost: string | null;
  acquisitionDate: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}
