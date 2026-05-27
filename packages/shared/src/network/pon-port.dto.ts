/**
 * DTOs de PonPort — porta PON da OLT (R8.3 OSP).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Doc: docs/architecture/osp-network.md
 *
 * Cada PON port da OLT é a ORIGEM do sinal óptico. Vinculá-la a (cabo, fibra)
 * é o que destrava o power budget automático — sem isso, traversal não tem
 * âncora.
 */
import { z } from 'zod';

// =============================================================================
// Create
// =============================================================================
export const CreatePonPortRequestSchema = z.object({
  oltId: z.string().uuid(),
  ponIndex: z.coerce.number().int().min(1).max(256),
  /** Cabo backbone saindo desta porta. Nullable durante construção. */
  cableId: z.string().uuid().nullish(),
  /** Fibra do cabo (1..fiberCount). Validado no service. */
  fiberIndex: z.coerce.number().int().min(1).max(432).nullish(),
  /** Potência TX. null = default GPON Class B+ (+3 dBm). */
  txPowerDbm: z.coerce.number().min(-10).max(20).nullish(),
  notes: z
    .string()
    .max(2000)
    .nullish()
    .transform((v) => (v === '' ? null : v)),
});
export type CreatePonPortRequest = z.infer<typeof CreatePonPortRequestSchema>;

// =============================================================================
// Update
// =============================================================================
export const UpdatePonPortRequestSchema = z
  .object({
    cableId: z.string().uuid().nullish(),
    fiberIndex: z.coerce.number().int().min(1).max(432).nullish(),
    txPowerDbm: z.coerce.number().min(-10).max(20).nullish(),
    notes: z
      .string()
      .max(2000)
      .nullish()
      .transform((v) => (v === '' ? null : v)),
  })
  .strict();
export type UpdatePonPortRequest = z.infer<typeof UpdatePonPortRequestSchema>;

// =============================================================================
// Response
// =============================================================================
export interface PonPortResponse {
  id: string;
  tenantId: string;
  oltId: string;
  oltName: string;
  ponIndex: number;
  cableId: string | null;
  cable: { id: string; code: string; fiberCount: number } | null;
  fiberIndex: number | null;
  txPowerDbm: number | null;
  /** Resolved TX — txPowerDbm OR default da tabela. */
  effectiveTxPowerDbm: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

// =============================================================================
// Power budget AUTOMÁTICO — query parameters do endpoint /power-budget/at
// =============================================================================
export const PowerBudgetAtSchema = z.object({
  /** Cabo onde está o ponto de medição. */
  cableId: z.string().uuid(),
  /** Fibra específica desse cabo. */
  fiberIndex: z.coerce.number().int().min(1).max(432),
  /**
   * Distância OPCIONAL em metros desde o endpoint A do cabo.
   * Quando informado, soma só a fração de fibra até esse ponto. Quando
   * ausente, considera o cabo todo (mede no endpoint B).
   */
  distanceMeters: z.coerce.number().min(0).max(1_000_000).optional(),
});
export type PowerBudgetAtQuery = z.infer<typeof PowerBudgetAtSchema>;

export interface PowerBudgetHop {
  kind:
    | 'olt-tx'
    | 'fiber'
    | 'splice'
    | 'splitter'
    | 'connector'
    | 'unreachable';
  label: string;
  lossDb: number;
  detail?: string;
}

export interface PowerBudgetAtResult {
  /** True se chegamos numa PonPort de origem; false se topologia incompleta. */
  resolved: boolean;
  /** Razão quando resolved=false (operador entende o que falta). */
  unresolvedReason?: string;
  /** Caminho do ponto até a OLT (ordem: ponto → OLT). */
  path: PowerBudgetHop[];
  /** Soma de losses no caminho. */
  totalLossDb: number;
  /** Quando resolved=true, OLT origem encontrada. */
  origin?: {
    oltId: string;
    oltName: string;
    ponIndex: number;
    txPowerDbm: number;
  };
  /** Potência prevista no PONTO consultado (TX - lossTotal). */
  predictedDbm: number | null;
}
