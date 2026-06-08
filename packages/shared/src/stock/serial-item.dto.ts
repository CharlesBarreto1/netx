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
