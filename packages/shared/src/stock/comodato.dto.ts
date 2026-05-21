import { z } from 'zod';

/**
 * Comodato — equipamento patrimonial vinculado a um contrato.
 *
 * Fluxo:
 *   1. Operador (ou técnico ao finalizar OS) escolhe um SerialItem disponível
 *      (status=IN_STOCK, product.type=PATRIMONIAL) e vincula ao contrato.
 *   2. Quando equipamento volta (cliente cancelou, troca, defeito), operador
 *      faz "devolver" e escolhe local destino.
 */

export const AllocateComodatoRequestSchema = z.object({
  contractId: z.string().uuid(),
  serialItemId: z.string().uuid(),
  notes: z.string().max(2000).nullish(),
});
export type AllocateComodatoRequest = z.infer<typeof AllocateComodatoRequestSchema>;

export const ReturnComodatoRequestSchema = z.object({
  serialItemId: z.string().uuid(),
  toLocationId: z.string().uuid(),
  notes: z.string().max(2000).nullish(),
});
export type ReturnComodatoRequest = z.infer<typeof ReturnComodatoRequestSchema>;

export interface ComodatoSerialResponse {
  id: string;
  serial: string;
  status: string;
  allocatedAt: string | null;
  product: {
    id: string;
    sku: string;
    name: string;
    brand?: string | null;
    model?: string | null;
  };
}
