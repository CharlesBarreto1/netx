/**
 * DTOs do catálogo de Planos de internet.
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Um Plan define velocidade (download/upload) + preço mensal. O contrato
 * referencia um plano e denormaliza os valores no momento da criação.
 *
 * @provenance Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=
 */
import { z } from 'zod';

const optionalString = (max: number) =>
  z
    .string()
    .max(max)
    .nullish()
    .transform((v) => (v === '' ? null : v ?? null));

export const CreatePlanRequestSchema = z.object({
  name: z.string().min(1).max(120),
  description: optionalString(500),
  /** Velocidades em Mbps. */
  downloadMbps: z.coerce.number().int().min(1).max(1_000_000),
  uploadMbps: z.coerce.number().int().min(1).max(1_000_000),
  /** Preço mensal na moeda do tenant. */
  monthlyPrice: z.coerce.number().nonnegative().max(100_000_000),
  /**
   * Dias após o vencimento até o contrato ser suspenso por inadimplência.
   * Default 5 (replica o comportamento histórico hardcoded em OverdueScan).
   * Faixa 0..60. Pode ser sobrescrito por contrato em Contract.blockAfterDays.
   */
  blockAfterDays: z.coerce.number().int().min(0).max(60).default(5),
  isActive: z.coerce.boolean().default(true),
  order: z.coerce.number().int().min(0).default(0),
  /**
   * Override do template de provisionamento de OLT (Fase 2 — Zyxel). Quando
   * setado, vence o default da OLT na hora de autorizar a ONT.
   */
  provisioningProfileId: z.string().uuid().nullish(),
});
export type CreatePlanRequest = z.infer<typeof CreatePlanRequestSchema>;

// .partial() sozinho NÃO basta: no Zod 4 o default ainda é injetado quando o
// campo vem ausente, resetando silenciosamente isActive/order/blockAfterDays
// num PATCH parcial. Removemos os defaults explicitamente.
export const UpdatePlanRequestSchema = CreatePlanRequestSchema.partial().extend({
  blockAfterDays: CreatePlanRequestSchema.shape.blockAfterDays.removeDefault().optional(),
  isActive: CreatePlanRequestSchema.shape.isActive.removeDefault().optional(),
  order: CreatePlanRequestSchema.shape.order.removeDefault().optional(),
});
export type UpdatePlanRequest = z.infer<typeof UpdatePlanRequestSchema>;

export const ListPlansQuerySchema = z.object({
  /** Se true, inclui planos inativos. Default false. */
  includeInactive: z.coerce.boolean().default(false),
});
export type ListPlansQuery = z.infer<typeof ListPlansQuerySchema>;

export interface PlanResponse {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  downloadMbps: number;
  uploadMbps: number;
  /** String pra preservar precisão decimal. */
  monthlyPrice: string;
  /** Dias após vencimento até suspender (default 5). Override em Contract. */
  blockAfterDays: number;
  isActive: boolean;
  order: number;
  /** Override de template de provisionamento (Fase 2 — Zyxel). */
  provisioningProfileId: string | null;
  provisioningProfileName?: string | null;
  /** Quantos contratos usam este plano (pra UI avisar antes de desativar). */
  contractCount?: number;
  createdAt: string;
  updatedAt: string;
}
