/**
 * FiberMap — DTOs do localizador OTDR (FM-5, spec §5.5).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * POST /fibermap/otdr/locate converte a distância medida no OTDR em campo
 * numa coordenada geográfica aproximada do evento, com raio de incerteza.
 * A caminhada consome sobras ANTES do comprimento de cada trecho (§5.5.3):
 * distância dentro de sobra ⇒ o evento está NA caixa (IN_SLACK); splitter
 * antes da distância ⇒ um candidato por ramo (AMBIGUOUS_AFTER_SPLITTER);
 * distância além da ponta documentada ⇒ BEYOND_END.
 *
 * A consulta é persistida em fibermap_otdr_readings com o snapshot do
 * resultado (log histórico — sobrevive à remoção de elementos).
 */
import { z } from 'zod';

export const FIBERMAP_OTDR_EVENT_TYPES = [
  'BREAK',
  'HIGH_LOSS',
  'REFLECTIVE',
  'END',
] as const;
export type FibermapOtdrEventType = (typeof FIBERMAP_OTDR_EVENT_TYPES)[number];

export const FibermapOtdrLocateRequestSchema = z.object({
  referenceElementId: z.string().uuid(),
  cableId: z.string().uuid(),
  fiberNumber: z.coerce.number().int().min(1),
  /** Elemento vizinho (na rota do cabo) que define o sentido da medição. */
  directionElementId: z.string().uuid(),
  distanceM: z.coerce.number().positive().max(500_000),
  wavelengthNm: z.coerce
    .number()
    .int()
    .default(1550)
    .refine((v) => [1310, 1490, 1550].includes(v), 'λ deve ser 1310, 1490 ou 1550'),
  eventType: z.enum(FIBERMAP_OTDR_EVENT_TYPES).default('BREAK'),
});
export type FibermapOtdrLocateRequest = z.infer<typeof FibermapOtdrLocateRequestSchema>;

export type FibermapOtdrFlag = 'IN_SLACK' | 'AMBIGUOUS_AFTER_SPLITTER' | 'BEYOND_END';

export interface FibermapOtdrCandidate {
  /** ON_SEGMENT = ponto interpolado; IN_SLACK/BEYOND_END = na caixa/ponta. */
  kind: 'ON_SEGMENT' | 'IN_SLACK' | 'BEYOND_END';
  latitude: number;
  longitude: number;
  uncertaintyRadiusM: number;
  /** Ramo(s) de splitter atravessado(s) — null quando o caminho é único. */
  branchLabel: string | null;
  cableId?: string;
  cableName?: string;
  segmentId?: string;
  /** Nomes dos elementos do segmento, NO SENTIDO da caminhada. */
  betweenElements?: [string, string];
  /** Offset ÓPTICO dentro do segmento, a partir da ponta de saída. */
  offsetM?: number;
  elementId?: string;
  elementName?: string;
}

export interface FibermapOtdrExpectedEvent {
  type: 'FUSION' | 'CONNECTOR' | 'SPLITTER' | 'END';
  elementId: string | null;
  elementName: string | null;
  /** Distância OTDR teórica do evento — correlaciona a curva inteira. */
  expectedOtdrM: number;
  detail: string | null;
}

export interface FibermapOtdrLocateResponse {
  readingId: string;
  flags: FibermapOtdrFlag[];
  /** Conveniência: coordenada/incerteza do primeiro candidato. */
  point: { latitude: number; longitude: number } | null;
  uncertaintyRadiusM: number | null;
  candidates: FibermapOtdrCandidate[];
  /** Elementos num raio de 250 m do primeiro candidato (mais próximos). */
  nearestElements: Array<{ id: string; name: string; distanceM: number }>;
  expectedEvents: FibermapOtdrExpectedEvent[];
}

export const ListFibermapOtdrReadingsQuerySchema = z.object({
  cableId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListFibermapOtdrReadingsQuery = z.infer<
  typeof ListFibermapOtdrReadingsQuerySchema
>;

// =============================================================================
// Calibração do fator de excesso (FM-6, spec §5.5.8)
// =============================================================================
/**
 * 2+ eventos identificados na curva (distância MEDIDA no OTDR × distância
 * TEÓRICA dos expected_events) ajustam o excess_factor DA INSTÂNCIA do cabo
 * (nunca do produto — §14.10) por mínimos quadrados pela origem.
 */
export const FibermapCalibrateExcessRequestSchema = z.object({
  pairs: z
    .array(
      z.object({
        /** Distância teórica do evento (expected_otdr_m). */
        expectedM: z.coerce.number().positive(),
        /** Distância onde o evento apareceu na curva do OTDR. */
        measuredM: z.coerce.number().positive(),
      }),
    )
    .min(2)
    .max(50),
});
export type FibermapCalibrateExcessRequest = z.infer<
  typeof FibermapCalibrateExcessRequestSchema
>;

export interface FibermapCalibrateExcessResponse {
  cableId: string;
  /** Fator de correção ajustado (medido ÷ teórico). */
  k: number;
  oldExcessFactor: number;
  newExcessFactor: number;
  /** true quando o novo excesso bateu no limite [0,9 · 1,2]. */
  clamped: boolean;
}

export interface FibermapOtdrReadingItem {
  id: string;
  cableId: string;
  cableName: string | null;
  fiberNumber: number;
  referenceElementId: string | null;
  referenceElementName: string | null;
  directionElementId: string;
  directionElementName: string | null;
  distanceM: number;
  wavelengthNm: number;
  eventType: FibermapOtdrEventType;
  createdAt: string;
  /** Snapshot do FibermapOtdrLocateResponse calculado na hora. */
  result: unknown;
}
