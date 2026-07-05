/**
 * FiberMap — DTOs do trace de capilar (FM-4, spec §5.1/§5.2).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * GET /fibermap/fibers/:id/trace e GET /fibermap/ports/:id/trace devolvem a
 * caminhada completa do grafo de conectividade a partir de um endpoint: lista
 * de eventos com distância/perda acumuladas (formato do tooltip do Tomodat),
 * ramificação em splitter (downstream = árvore; upstream converge pra IN) e a
 * geometria MultiLineString dos segmentos percorridos pro highlight no mapa.
 *
 * Convenção de apresentação: quando algum braço do componente alcança um
 * TERMINAL de porta (idealmente OLT), o caminho é normalizado a partir dele —
 * é o que o técnico espera ler ("OLT → … → ponta"). Senão, o caminho parte do
 * endpoint pedido. Splitters atravessados "de subida" durante a normalização
 * aparecem como evento SPLITTER com branchTaken (sem árvore).
 */
import { z } from 'zod';

// =============================================================================
// Queries
// =============================================================================
/** λ suportados pela tabela de atenuação (FIBER_1310/1490/1550). */
export const FIBERMAP_TRACE_WAVELENGTHS = [1310, 1490, 1550] as const;
export type FibermapTraceWavelength = (typeof FIBERMAP_TRACE_WAVELENGTHS)[number];

const WavelengthSchema = z.coerce
  .number()
  .int()
  .default(1490)
  .refine(
    (v) => (FIBERMAP_TRACE_WAVELENGTHS as readonly number[]).includes(v),
    'comprimento de onda deve ser 1310, 1490 ou 1550',
  );

export const FibermapFiberTraceQuerySchema = z
  .object({
    /** Extremidade de partida (default A). Ignorado quando cutId presente. */
    from: z.enum(['A', 'B']).optional(),
    /** Trace a partir de uma ponta de corte (exige cutSide). */
    cutId: z.string().uuid().optional(),
    cutSide: z.enum(['U', 'D']).optional(),
    wavelength: WavelengthSchema,
  })
  .superRefine((v, ctx) => {
    if (v.cutId && v.from) {
      ctx.addIssue({ code: 'custom', message: 'use from OU cutId, não ambos' });
    }
    if (Boolean(v.cutId) !== Boolean(v.cutSide)) {
      ctx.addIssue({ code: 'custom', message: 'cutId e cutSide andam juntos' });
    }
  });
export type FibermapFiberTraceQuery = z.infer<typeof FibermapFiberTraceQuerySchema>;

export const FibermapPortTraceQuerySchema = z.object({
  wavelength: WavelengthSchema,
});
export type FibermapPortTraceQuery = z.infer<typeof FibermapPortTraceQuerySchema>;

// =============================================================================
// Resposta
// =============================================================================
export type FibermapTraceEventKind =
  | 'PORT'
  | 'CONNECTOR'
  | 'FUSION'
  | 'FIBER'
  | 'SPLITTER'
  | 'END';

/** Sub-caminho de uma porta OUT de splitter (ramificação downstream). */
export interface FibermapTraceBranch {
  outPortNumber: number;
  outPortLabel: string | null;
  events: FibermapTraceEvent[];
}

export interface FibermapTraceEvent {
  kind: FibermapTraceEventKind;
  /** Elemento do evento (FIBER: elemento de CHEGADA do trecho). */
  elementId?: string;
  elementName?: string;
  latitude?: number;
  longitude?: number;
  // PORT / SPLITTER
  deviceId?: string;
  deviceName?: string;
  deviceType?: string;
  portId?: string;
  portLabel?: string;
  portRole?: 'IN' | 'OUT' | 'BIDI';
  // FIBER
  cableId?: string;
  cableName?: string;
  fiberId?: string;
  fiberNumber?: number;
  tubeNumber?: number;
  fiberColor?: string;
  /** Comprimento ÓPTICO do trecho (inclui sobras — regra §5.2). */
  lengthM?: number;
  // CONNECTOR / FUSION
  connectionId?: string;
  /** Perda do evento (fibra: λ×km; conexão: lossDb ?? default do tipo). */
  lossDb?: number;
  cumDistanceM: number;
  cumLossDb: number;
  // SPLITTER
  ratio?: string;
  branchCount?: number;
  /** Caminho restrito/upstream: qual OUT foi atravessada. */
  branchTaken?: number;
  /** Downstream sem restrição: uma sub-árvore por OUT livre. */
  branches?: FibermapTraceBranch[];
  // END
  endReason?: 'FREE_END' | 'LOOP';
}

export interface FibermapTraceOriginRef {
  kind: 'FIBER_END' | 'CUT_END' | 'PORT';
  fiberId?: string;
  side?: 'A' | 'B' | 'U' | 'D';
  cutId?: string;
  portId?: string;
}

export interface FibermapTraceResponse {
  wavelengthNm: number;
  /** Eco do endpoint pedido (o painel destaca o trecho clicado). */
  origin: FibermapTraceOriginRef;
  path: FibermapTraceEvent[];
  /** Piores acumulados entre todas as folhas (ramo mais longo/mais perda). */
  maxDistanceM: number;
  maxLossDb: number;
  /** Segmentos percorridos, GeoJSON [[lng,lat],…] por linha — highlight. */
  mapGeometry: { type: 'MultiLineString'; coordinates: number[][][] };
}
