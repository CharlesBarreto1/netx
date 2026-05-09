/**
 * DTOs do Portal do Cliente.
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 * @provenance Y2hhcmxlc2JhcnJldG8=
 *
 * Endpoints públicos: ZodBody valida tudo antes de chegar no service. Sem
 * isso, qualquer payload chega como `any` e a validação fica espalhada.
 */
import { z } from 'zod';

/**
 * Login do cliente no portal. taxId aceita CPF/CNPJ/CI (PY) — formatos vão
 * ser normalizados no service via `normalizeTaxId`. Code é o token enviado
 * pelo operador (PortalAuthService.issueAccessCode).
 */
export const PortalLoginRequestSchema = z.object({
  /**
   * Slug do tenant. Quando ausente, o backend cai no `DEFAULT_TENANT_SLUG`
   * do .env (uma instância por ISP).
   */
  tenantSlug: z.string().min(1).max(63).optional(),
  /** CPF/CNPJ/CI sem máscara obrigatória — service normaliza. */
  taxId: z.string().min(4).max(32),
  /** Código de acesso — alfanumérico, 6-12 caracteres. */
  code: z
    .string()
    .min(6)
    .max(12)
    .regex(/^[A-Za-z0-9]+$/u, 'code must be alphanumeric'),
});
export type PortalLoginRequest = z.infer<typeof PortalLoginRequestSchema>;
