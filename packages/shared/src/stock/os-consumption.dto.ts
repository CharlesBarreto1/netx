import { z } from 'zod';

/**
 * Consumo de material em OS — só produtos CONSUMIVEL.
 *
 * Pode ser chamado:
 *   - via endpoint dedicado durante a OS (POST /v1/service-orders/:id/consumption)
 *   - ou consolidado na finalização (extensão futura do endpoint complete)
 */

const decimalPositive = z
  .union([z.string().regex(/^\d+(\.\d{1,4})?$/), z.number()])
  .transform((v) => Number(v))
  .refine((n) => Number.isFinite(n) && n > 0, 'Deve ser > 0');

export const ConsumptionItemSchema = z.object({
  productId: z.string().uuid(),
  locationId: z.string().uuid(),
  quantity: decimalPositive,
  notes: z.string().max(2000).nullish(),
});
export type ConsumptionItem = z.infer<typeof ConsumptionItemSchema>;

export const AddOsConsumptionRequestSchema = z.object({
  items: z.array(ConsumptionItemSchema).min(1, 'Informe pelo menos 1 item'),
});
export type AddOsConsumptionRequest = z.infer<typeof AddOsConsumptionRequestSchema>;

export interface OsConsumptionMovementResponse {
  id: string;
  productId: string;
  productName?: string;
  productSku?: string;
  productUnit?: string;
  locationId: string;
  locationName?: string;
  quantity: string;
  unitCost: string;
  totalCost: string;
  notes: string | null;
  createdAt: string;
  createdByName?: string;
}
