import { z } from 'zod';

// -----------------------------------------------------------------------------
// Enums (devem ficar idênticos ao schema.prisma)
// -----------------------------------------------------------------------------
export const CustomerTypeSchema = z.enum(['INDIVIDUAL', 'COMPANY']);
export type CustomerType = z.infer<typeof CustomerTypeSchema>;

export const CustomerStatusSchema = z.enum([
  'LEAD',
  'PROSPECT',
  'ACTIVE',
  'SUSPENDED',
  'INACTIVE',
  'CHURNED',
]);
export type CustomerStatus = z.infer<typeof CustomerStatusSchema>;

export const TaxIdTypeSchema = z.enum([
  'CPF',
  'CNPJ',
  'CI',
  'RUC',
  'VAT',
  'NIF',
  'RFC',
  'CUIT',
  'RUT',
  'NIT',
  'SSN',
  'EIN',
  'OTHER',
]);
export type TaxIdType = z.infer<typeof TaxIdTypeSchema>;

// -----------------------------------------------------------------------------
// Identificação fiscal
// -----------------------------------------------------------------------------
export const TaxIdSchema = z.object({
  type: TaxIdTypeSchema,
  country: z.string().length(2).toUpperCase(), // ISO alpha-2
  value: z.string().min(1).max(32),
});
export type TaxId = z.infer<typeof TaxIdSchema>;

// -----------------------------------------------------------------------------
// Create / Update
// -----------------------------------------------------------------------------
const baseCustomerFields = {
  code: z.string().max(32).optional(),
  status: CustomerStatusSchema.optional(),
  taxId: TaxIdSchema.nullish(),

  primaryEmail: z.string().email().max(255).nullish(),
  primaryPhone: z.string().max(32).nullish(),

  preferredLanguage: z.string().max(10).nullish(),
  timezone: z.string().max(64).nullish(),

  shortNote: z.string().max(500).nullish(),
  metadata: z.record(z.unknown()).nullish(),
};

const individualFields = {
  type: z.literal('INDIVIDUAL'),
  firstName: z.string().min(1).max(120),
  lastName: z.string().min(1).max(120),
  birthDate: z.string().date().nullish(), // YYYY-MM-DD
  gender: z.string().max(32).nullish(),
  motherName: z.string().max(255).nullish(),
};

const companyFields = {
  type: z.literal('COMPANY'),
  companyName: z.string().min(1).max(255), // razão social
  tradeName: z.string().max(255).nullish(), // nome fantasia
  foundedAt: z.string().date().nullish(),
  stateRegistration: z.string().max(64).nullish(),
  municipalRegistration: z.string().max(64).nullish(),
};

export const CreateCustomerRequestSchema = z.discriminatedUnion('type', [
  z.object({ ...baseCustomerFields, ...individualFields }),
  z.object({ ...baseCustomerFields, ...companyFields }),
]);
export type CreateCustomerRequest = z.infer<typeof CreateCustomerRequestSchema>;

// Update aceita campos parciais — o tipo do cliente NÃO pode mudar após criação,
// então o discriminator some no update (vira partial dos dois somados).
export const UpdateCustomerRequestSchema = z
  .object({
    ...baseCustomerFields,
    firstName: z.string().min(1).max(120).optional(),
    lastName: z.string().min(1).max(120).optional(),
    birthDate: z.string().date().nullish(),
    gender: z.string().max(32).nullish(),
    motherName: z.string().max(255).nullish(),
    companyName: z.string().min(1).max(255).optional(),
    tradeName: z.string().max(255).nullish(),
    foundedAt: z.string().date().nullish(),
    stateRegistration: z.string().max(64).nullish(),
    municipalRegistration: z.string().max(64).nullish(),
  })
  .partial();
export type UpdateCustomerRequest = z.infer<typeof UpdateCustomerRequestSchema>;

// -----------------------------------------------------------------------------
// Listagem / busca
// -----------------------------------------------------------------------------
export const ListCustomersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(255).optional(),                    // nome/email/fone/taxId parcial
  status: CustomerStatusSchema.optional(),
  type: CustomerTypeSchema.optional(),
  tag: z.string().uuid().optional(),                         // tagId
  taxIdType: TaxIdTypeSchema.optional(),
  country: z.string().length(2).toUpperCase().optional(),    // taxIdCountry
  createdFrom: z.string().date().optional(),
  createdTo: z.string().date().optional(),
});
export type ListCustomersQuery = z.infer<typeof ListCustomersQuerySchema>;

// -----------------------------------------------------------------------------
// Response
// -----------------------------------------------------------------------------
export interface CustomerResponse {
  id: string;
  tenantId: string;
  code: string | null;
  type: CustomerType;
  status: CustomerStatus;

  // PF
  firstName: string | null;
  lastName: string | null;
  birthDate: string | null;
  gender: string | null;
  motherName: string | null;

  // PJ
  companyName: string | null;
  tradeName: string | null;
  foundedAt: string | null;
  stateRegistration: string | null;
  municipalRegistration: string | null;

  // Comum
  displayName: string;
  taxId: string | null;
  taxIdType: TaxIdType | null;
  taxIdCountry: string | null;
  taxIdVerifiedAt: string | null;
  primaryEmail: string | null;
  primaryPhone: string | null;
  preferredLanguage: string | null;
  timezone: string | null;
  shortNote: string | null;
  metadata: Record<string, unknown> | null;

  tags?: Array<{ id: string; name: string; color: string | null }>;

  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}
