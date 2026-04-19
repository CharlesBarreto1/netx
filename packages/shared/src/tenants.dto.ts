import { z } from 'zod';

export const TenantStatusSchema = z.enum(['ACTIVE', 'SUSPENDED', 'TRIAL', 'CHURNED']);
export type TenantStatus = z.infer<typeof TenantStatusSchema>;

export const CreateTenantRequestSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/, 'lowercase, digits and hyphens only').min(3).max(63),
  name: z.string().min(2).max(255),
  legalName: z.string().max(255).optional(),
  taxId: z.string().max(32).optional(),
  country: z.string().length(2).toUpperCase(),
  locale: z.string().max(10).default('pt-BR'),
  timezone: z.string().max(64).default('America/Sao_Paulo'),
  currency: z.string().length(3).toUpperCase().default('BRL'),
});
export type CreateTenantRequest = z.infer<typeof CreateTenantRequestSchema>;

export interface TenantResponse {
  id: string;
  slug: string;
  name: string;
  legalName: string | null;
  taxId: string | null;
  country: string;
  locale: string;
  timezone: string;
  currency: string;
  status: TenantStatus;
  trialEndsAt: string | null;
  createdAt: string;
  updatedAt: string;
}
