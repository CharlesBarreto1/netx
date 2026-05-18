import { z } from 'zod';

/**
 * Schemas Zod pra Supplier (fornecedor). Separado de Customer porque a
 * semântica é diferente: fornecedor é quem nos vende; customer é quem
 * compra de nós. Compartilhar a entidade convidaria a bugs sutis (ex.: filtrar
 * "clientes ativos" e aparecer fornecedor na lista).
 */

const optionalString = (max: number) =>
  z
    .string()
    .max(max)
    .nullish()
    .transform((v) => (v === '' ? null : v ?? null));

const TAX_ID_TYPES = ['CNPJ', 'CPF', 'RUC', 'DNI', 'CI', 'OTHER'] as const;

export const SupplierTaxIdTypeSchema = z.enum(TAX_ID_TYPES);
export type SupplierTaxIdType = z.infer<typeof SupplierTaxIdTypeSchema>;

export const CreateSupplierRequestSchema = z.object({
  name: z.string().min(1).max(255),
  taxId: optionalString(32),
  taxIdType: SupplierTaxIdTypeSchema.nullish(),
  email: z.string().email().max(255).nullish().or(z.literal('').transform(() => null)),
  phone: optionalString(40),
  address: optionalString(500),
  city: optionalString(120),
  state: optionalString(120),
  notes: optionalString(2000),
  isActive: z.coerce.boolean().default(true),
});
export type CreateSupplierRequest = z.infer<typeof CreateSupplierRequestSchema>;

export const UpdateSupplierRequestSchema = CreateSupplierRequestSchema.partial();
export type UpdateSupplierRequest = z.infer<typeof UpdateSupplierRequestSchema>;

export interface SupplierResponse {
  id: string;
  tenantId: string;
  name: string;
  taxId: string | null;
  taxIdType: SupplierTaxIdType | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
