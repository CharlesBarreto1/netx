/**
 * DTOs do cálculo de power budget óptico (R5 OSP).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Doc: docs/architecture/osp-network.md
 *
 * v1 = calculadora manual: operador informa parâmetros do caminho
 * (splitter, fibra, fusões, conectores) e recebe breakdown dB.
 *
 * v2 (futuro) = traversal automático contrato→ONT→OLT pelo grafo de
 * cabos+fusões. Precisa do vínculo OpticalPort↔cabo-drop, que ainda não
 * existe no schema (criado durante fluxo de instalação no app mobile).
 *
 * Valores padrão (ITU-T G.984.5 + heurísticas de campo):
 *   Conector SC/APC      0.50 dB
 *   Fusão (splice)       0.10 dB (ou medido na FiberSplice.lossDb)
 *   Splitter 1:2         3.5 dB
 *   Splitter 1:4         7.0 dB
 *   Splitter 1:8        10.5 dB
 *   Splitter 1:16       14.0 dB
 *   Splitter 1:32       17.0 dB
 *   Splitter 1:64       20.5 dB
 *   Fibra @ 1310 nm     0.40 dB/km  (upstream GPON)
 *   Fibra @ 1490 nm     0.30 dB/km  (downstream GPON)
 *   Fibra @ 1550 nm     0.25 dB/km  (RFoG/XG-PON)
 *
 * Potência típica:
 *   OLT TX            +3.0 dBm (GPON Class B+)
 *   ONT RX sensitivity -28.0 dBm (mínimo aceitável)
 *   Janela útil       31 dB total
 */
import { z } from 'zod';

import { SplitterRatioSchema } from './optical.dto';

export const WavelengthNmSchema = z.enum(['1310', '1490', '1550']);
export type WavelengthNm = z.infer<typeof WavelengthNmSchema>;

/** Coeficientes editáveis por tenant. v1 usa defaults; v2 lê de tenant_settings. */
export const DEFAULT_POWER_BUDGET_COEFFICIENTS = {
  connectorLossDb: 0.5,
  spliceLossDbDefault: 0.1,
  splitterLossDb: {
    ONE_TO_2: 3.5,
    ONE_TO_4: 7.0,
    ONE_TO_8: 10.5,
    ONE_TO_16: 14.0,
    ONE_TO_32: 17.0,
    ONE_TO_64: 20.5,
  },
  fiberAttenDbPerKm: {
    '1310': 0.4,
    '1490': 0.3,
    '1550': 0.25,
  },
  // Padrão GPON Class B+ — operador pode override se OLT tiver SFP diferente.
  oltTxDbm: 3.0,
  // RX sensitivity típica do ONT (mínimo aceitável). Abaixo disso = sem link.
  ontRxMinDbm: -28.0,
  // Margem de segurança recomendada (3 dB) — operador deve manter pelo menos
  // 3 dB de folga sobre o RX mínimo pra absorver degradação ao longo do tempo.
  recommendedMarginDb: 3.0,
} as const;

// =============================================================================
// Input — calculadora manual
// =============================================================================
export const CalculatePowerBudgetRequestSchema = z.object({
  /** Comprimento total da fibra entre OLT e ONT, em metros. */
  fiberLengthMeters: z.coerce.number().min(0).max(1_000_000),
  /** Comprimento de onda usado. Default 1490 (downstream GPON). */
  wavelengthNm: WavelengthNmSchema.default('1490'),
  /**
   * Splitters no caminho. Cascata 1:8 → 1:8 = total 1:64 efetivo, mas o
   * loss soma os dois. Array suporta até 2 níveis (raramente +).
   */
  splitterRatios: z.array(SplitterRatioSchema).max(3).default([]),
  /** Número de fusões/emendas no caminho. */
  spliceCount: z.coerce.number().int().min(0).max(50).default(0),
  /**
   * Loss por fusão. Default 0.1 dB. Quando há FiberSplice cadastrado no
   * caminho com lossDb medido, v2 vai somar esses valores específicos —
   * v1 só usa o uniforme.
   */
  spliceLossDbPerSplice: z.coerce
    .number()
    .min(0)
    .max(2)
    .default(0.1),
  /** Conectores no caminho. Default 2 (OLT + ONT). */
  connectorCount: z.coerce.number().int().min(0).max(20).default(2),
  /** Loss por conector. Default 0.5 dB. */
  connectorLossDb: z.coerce.number().min(0).max(2).default(0.5),
  /** TX de saída da OLT (dBm). Default GPON Class B+ = +3 dBm. */
  oltTxDbm: z.coerce.number().min(-10).max(20).default(3.0),
  /** Sensitivity mínima do ONT. Default -28 dBm. */
  ontRxMinDbm: z.coerce.number().min(-40).max(0).default(-28.0),
  /**
   * Potência medida no ONT (opcional). Quando informado, calcula diff
   * orçado vs medido — útil pra diagnosticar degradação.
   */
  measuredOntRxDbm: z.coerce.number().min(-40).max(0).nullish(),
});
export type CalculatePowerBudgetRequest = z.infer<
  typeof CalculatePowerBudgetRequestSchema
>;

// =============================================================================
// Response — breakdown completo
// =============================================================================
export interface PowerBudgetBreakdownItem {
  label: string;
  /** Loss em dB. Sempre positivo (perda). */
  lossDb: number;
  /** Detalhe humano (ex: "0.30 dB/km × 1.520 km"). */
  detail?: string;
}

export interface PowerBudgetResult {
  breakdown: PowerBudgetBreakdownItem[];
  /** Soma de todas as perdas. */
  totalLossDb: number;
  /** Potência prevista no ONT = oltTxDbm - totalLossDb. */
  predictedOntRxDbm: number;
  /** Janela disponível = oltTxDbm - ontRxMinDbm. */
  totalBudgetDb: number;
  /** Margem = totalBudgetDb - totalLossDb. Positivo = OK; negativo = sem link. */
  marginDb: number;
  /**
   * Classificação visual:
   *   - 'safe': margem ≥ 3 dB (recomendado)
   *   - 'tight': margem entre 0 e 3 dB (link funciona mas vulnerável)
   *   - 'fail': margem negativa (não vai linkar)
   */
  status: 'safe' | 'tight' | 'fail';
  /** Se measuredOntRxDbm foi informado, diff entre previsto e medido. */
  measurement?: {
    measuredOntRxDbm: number;
    diffDb: number;
    /**
     * Classificação do diff:
     *   - 'matches': abs(diff) ≤ 1 dB
     *   - 'better': measured > predicted + 1 (planta melhor que orçada)
     *   - 'degraded': measured < predicted - 1 (degradação real)
     */
    diffClass: 'matches' | 'better' | 'degraded';
  };
}
