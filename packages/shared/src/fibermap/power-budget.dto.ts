/**
 * FiberMap — DTOs do power budget (FM-6, spec §5.4).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * GET /fibermap/ports/:oltPortId/power-budget é o trace da porta (FM-4) com
 * outra saída: dBm esperado em cada evento (tx − perda acumulada) e nas
 * pontas finais, com nível OK/WARN/CRIT (defaults GPON classe B+: WARN
 * < −25 dBm, CRIT < −27 dBm — spec §5.4; sobrescrevível por query). Quando
 * existe power_measurement na mesma λ num ponto, o esperado × medido e o
 * delta aparecem juntos.
 */
import { z } from 'zod';

import type { FibermapTraceEvent, FibermapTraceOriginRef } from './trace.dto';

/** Limiares default (GPON classe B+, spec §5.4). */
export const FIBERMAP_BUDGET_WARN_DBM = -25;
export const FIBERMAP_BUDGET_CRIT_DBM = -27;

export const FibermapPowerBudgetQuerySchema = z.object({
  wavelength: z.coerce
    .number()
    .int()
    .default(1490)
    .refine((v) => [1310, 1490, 1550].includes(v), 'λ deve ser 1310, 1490 ou 1550'),
  /** Potência de transmissão na porta (dBm). Default +4 (GPON B+). */
  txDbm: z.coerce.number().min(-20).max(20).default(4),
  warnDbm: z.coerce.number().min(-40).max(0).default(FIBERMAP_BUDGET_WARN_DBM),
  critDbm: z.coerce.number().min(-45).max(0).default(FIBERMAP_BUDGET_CRIT_DBM),
});
export type FibermapPowerBudgetQuery = z.infer<typeof FibermapPowerBudgetQuerySchema>;

export type FibermapPowerBudgetLevel = 'OK' | 'WARN' | 'CRIT';

export interface FibermapPowerBudgetBranch {
  outPortNumber: number;
  outPortLabel: string | null;
  events: FibermapPowerBudgetEvent[];
}

/** Evento do trace enriquecido com o dBm esperado no ponto. */
export interface FibermapPowerBudgetEvent extends Omit<FibermapTraceEvent, 'branches'> {
  expectedDbm: number;
  level: FibermapPowerBudgetLevel;
  /** Medição mais recente na porta (mesma λ), quando houver. */
  measuredDbm?: number | null;
  measuredAt?: string | null;
  /** medido − esperado (positivo = melhor que o previsto). */
  deltaDb?: number | null;
  branches?: FibermapPowerBudgetBranch[];
}

/** Ponta final de um ramo — a linha da "tabela de assinantes" do budget. */
export interface FibermapPowerBudgetTerminal {
  /** Caminho de OUTs até aqui ('OUT 3' ou 'OUT 2 › OUT 5'); null = tronco. */
  branchPath: string | null;
  elementId?: string;
  elementName?: string;
  deviceName?: string;
  portId?: string;
  portLabel?: string;
  cableName?: string;
  fiberNumber?: number;
  endReason?: 'FREE_END' | 'LOOP';
  distanceM: number;
  lossDb: number;
  expectedDbm: number;
  level: FibermapPowerBudgetLevel;
  measuredDbm?: number | null;
  deltaDb?: number | null;
}

export interface FibermapPowerBudgetResponse {
  wavelengthNm: number;
  txDbm: number;
  warnDbm: number;
  critDbm: number;
  origin: FibermapTraceOriginRef;
  path: FibermapPowerBudgetEvent[];
  terminals: FibermapPowerBudgetTerminal[];
  /** Pior Rx esperado entre as pontas (null sem terminais). */
  worstDbm: number | null;
  maxDistanceM: number;
}
