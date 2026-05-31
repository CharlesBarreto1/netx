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
  /** Prefixo de 3 letras do código sequencial de contrato (ex.: "ZUX"). */
  contractPrefix: string | null;
  status: TenantStatus;
  trialEndsAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Atualização das parametrizações da operação (tenant atual).
 * `applyCountryDefaults` quando true: ao mudar `country`, o serviço sobrescreve
 * `locale`, `currency` e `timezone` com o preset desse país. Útil pro fluxo
 * de setup inicial — o admin escolhe "Paraguay" e o resto se ajusta sozinho.
 */
export const UpdateTenantSettingsRequestSchema = z
  .object({
    name: z.string().min(2).max(255).optional(),
    legalName: z.string().max(255).nullish(),
    taxId: z.string().max(32).nullish(),
    country: z.string().length(2).toUpperCase().optional(),
    locale: z.string().max(10).optional(),
    timezone: z.string().max(64).optional(),
    currency: z.string().length(3).toUpperCase().optional(),
    // Prefixo de 3 letras do código sequencial de contrato ({prefix}-{seq}).
    contractPrefix: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/, 'O prefixo deve ter exatamente 3 letras (A–Z)')
      .optional(),
    applyCountryDefaults: z.boolean().optional(),
  })
  .strict();
export type UpdateTenantSettingsRequest = z.infer<typeof UpdateTenantSettingsRequestSchema>;
