import { z } from 'zod';

const optionalString = (max: number) =>
  z.string().max(max).nullish().transform((v) => (v === '' ? null : v ?? null));

export const CreateStockLocationRequestSchema = z.object({
  // Code: identificador curto único por tenant. Aparece em listagens/relatórios.
  code: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[A-Z0-9._\-]+$/, 'Code só aceita maiúsculas, números, "." "_" "-"')
    .transform((s) => s.toUpperCase()),
  name: z.string().min(1).max(120),
  address: optionalString(500),
  isActive: z.coerce.boolean().default(true),
  // Lista de userIds que terão acesso a este local. Vazio = só roles com
  // `stock.admin` veem. Setá-lo aqui é atalho — pode também ser gerenciado
  // via endpoint dedicado depois.
  userIds: z.array(z.string().uuid()).default([]),
});
export type CreateStockLocationRequest = z.infer<typeof CreateStockLocationRequestSchema>;

export const UpdateStockLocationRequestSchema = CreateStockLocationRequestSchema.partial();
export type UpdateStockLocationRequest = z.infer<typeof UpdateStockLocationRequestSchema>;

// Endpoint dedicado pra gerenciar ACL — alternativa a passar userIds no update.
export const SetLocationAccessRequestSchema = z.object({
  userIds: z.array(
    z.object({
      userId: z.string().uuid(),
      canWrite: z.boolean().default(true),
    }),
  ),
});
export type SetLocationAccessRequest = z.infer<typeof SetLocationAccessRequestSchema>;

export interface StockLocationResponse {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  address: string | null;
  isActive: boolean;
  userAccess?: Array<{ userId: string; canWrite: boolean; userName?: string }>;
  // Saldo agregado por tipo:
  stats?: {
    consumableProducts: number;  // distinct products com saldo > 0
    serialItemsInStock: number;  // count of SerialItem IN_STOCK aqui
  };
  createdAt: string;
  updatedAt: string;
}
