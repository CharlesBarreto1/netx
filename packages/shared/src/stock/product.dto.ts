import { z } from 'zod';

/**
 * Product — catálogo de itens. Tipo discrimina o modelo de rastreio:
 *   PATRIMONIAL: cada unidade tem SerialItem com serial único. Comodato.
 *   CONSUMIVEL:  saldo agregado por (produto, local) em StockLevel. Consumo em OS.
 */

export const ProductTypeSchema = z.enum(['PATRIMONIAL', 'CONSUMIVEL']);
export type ProductType = z.infer<typeof ProductTypeSchema>;

const optionalString = (max: number) =>
  z.string().max(max).nullish().transform((v) => (v === '' ? null : v ?? null));

export const CreateProductRequestSchema = z.object({
  // SKU: identificador interno único por tenant. Operador define.
  // Sem auto-gerar pra que codes batam com inventário físico/etiquetas.
  sku: z.string().min(1).max(64).regex(/^[A-Za-z0-9._\-]+$/, 'SKU só aceita letras, números, "." "_" "-"'),
  name: z.string().min(1).max(255),
  description: optionalString(2000),
  brand: optionalString(120),
  model: optionalString(120),
  type: ProductTypeSchema,
  // Unidade — texto livre curto. "un", "m", "kg", "pç", "cx", etc.
  // Não usamos enum pra permitir flexibilidade entre tenants/países.
  unit: z.string().min(1).max(16).default('un'),
  // Preço de venda consultivo (venda real pode override no documento).
  // Decimal serializado como string pra evitar problemas de float em transit.
  price: z.union([z.string(), z.number()])
    .nullish()
    .transform((v) => (v === '' || v == null ? null : Number(v))),
  minStock: z.union([z.string(), z.number()])
    .nullish()
    .transform((v) => (v === '' || v == null ? null : Number(v))),
  isActive: z.coerce.boolean().default(true),
});
export type CreateProductRequest = z.infer<typeof CreateProductRequestSchema>;

export const UpdateProductRequestSchema = CreateProductRequestSchema
  .omit({ type: true }) // type não muda depois de criado (mudar PATRIMONIAL→CONSUMIVEL ou vice quebra histórico)
  .partial();
export type UpdateProductRequest = z.infer<typeof UpdateProductRequestSchema>;

export interface ProductResponse {
  id: string;
  tenantId: string;
  sku: string;
  name: string;
  description: string | null;
  brand: string | null;
  model: string | null;
  type: ProductType;
  unit: string;
  cost: string;           // weighted avg cost (string p/ preservar precisão decimal)
  price: string | null;
  minStock: string | null;
  isActive: boolean;
  // Saldo agregado global — calculado on-the-fly pelo service.
  totalStock?: string;    // para CONSUMIVEL: sum of StockLevel.quantity; para PATRIMONIAL: count of SerialItem WHERE status='IN_STOCK'
  totalAllocated?: number; // count de seriais ALLOCATED (só PATRIMONIAL)
  createdAt: string;
  updatedAt: string;
}
