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
  isActive: z.coerce.boolean().default(true),
  order: z.coerce.number().int().min(0).default(0),
});
export type CreatePlanRequest = z.infer<typeof CreatePlanRequestSchema>;

export const UpdatePlanRequestSchema = CreatePlanRequestSchema.partial();
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
  isActive: boolean;
  order: number;
  /** Quantos contratos usam este plano (pra UI avisar antes de desativar). */
  contractCount?: number;
  createdAt: string;
  updatedAt: string;
}
