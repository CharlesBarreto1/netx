/**
 * FiberMap — DTOs do ponto de acesso e do grafo lógico (FM-3, spec §3.5/§4/§8).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * GET /fibermap/elements/:id/access-point é a fonte única do editor de
 * emendas: todos os cabos incidentes (fibras com cores/cortes/pontas),
 * devices com portas (2 faces: C=conector frontal, F=pigtail/fusão) e as
 * conexões existentes com perdas.
 *
 * Endpoint óptico no transporte (mesma polimorfia do banco):
 *   FIBER_END → { fiberId, side: 'A'|'B' }            (extremidade do cabo)
 *   FIBER_END → { fiberId, side: 'U'|'D', cutId }     (ponta de corte)
 *   PORT      → { portId }                            (face derivada do kind)
 */
import { z } from 'zod';

// =============================================================================
// Endpoint polimórfico (POST /connections)
// =============================================================================
export const FibermapEndpointRefSchema = z
  .object({
    type: z.enum(['FIBER_END', 'PORT']),
    fiberId: z.string().uuid().optional(),
    /** A/B = extremidade; U/D = lado do corte (exige cutId). */
    side: z.enum(['A', 'B', 'U', 'D']).optional(),
    cutId: z.string().uuid().optional(),
    portId: z.string().uuid().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.type === 'FIBER_END') {
      if (!v.fiberId || !v.side) {
        ctx.addIssue({ code: 'custom', message: 'FIBER_END exige fiberId e side' });
      }
      if ((v.side === 'U' || v.side === 'D') !== Boolean(v.cutId)) {
        ctx.addIssue({ code: 'custom', message: 'lados U/D exigem cutId (e A/B proíbem)' });
      }
    } else {
      if (!v.portId) ctx.addIssue({ code: 'custom', message: 'PORT exige portId' });
      if (v.fiberId || v.cutId || v.side) {
        ctx.addIssue({ code: 'custom', message: 'PORT não leva fiberId/cutId/side' });
      }
    }
  });
export type FibermapEndpointRef = z.infer<typeof FibermapEndpointRefSchema>;

export const CreateFibermapConnectionRequestSchema = z.object({
  elementId: z.string().uuid(),
  /** FUSION = fusão (face F da porta) · CONNECTOR = conector/patch (face C). */
  kind: z.enum(['FUSION', 'CONNECTOR']),
  a: FibermapEndpointRefSchema,
  b: FibermapEndpointRefSchema,
  /** Perda medida; null/omitido = default do tipo (spec §5.3). */
  lossDb: z.coerce.number().min(0).max(60).nullish(),
  notes: z.string().max(2000).nullish(),
});
export type CreateFibermapConnectionRequest = z.infer<
  typeof CreateFibermapConnectionRequestSchema
>;

export const UpdateFibermapConnectionRequestSchema = z.object({
  lossDb: z.coerce.number().min(0).max(60).nullish(),
  notes: z.string().max(2000).nullish(),
});
export type UpdateFibermapConnectionRequest = z.infer<
  typeof UpdateFibermapConnectionRequestSchema
>;

// =============================================================================
// Corte (tesoura) e devices
// =============================================================================
export const CreateFibermapCutRequestSchema = z.object({
  elementId: z.string().uuid(),
});
export type CreateFibermapCutRequest = z.infer<typeof CreateFibermapCutRequestSchema>;

export const CreateFibermapDeviceRequestSchema = z
  .object({
    type: z.enum(['SPLITTER', 'DIO', 'OLT']),
    name: z.string().min(1).max(120),
    productId: z.string().uuid().nullish(),
    /** SPLITTER: razão gera 1 IN + N OUT. */
    ratio: z.enum(['1x2', '1x4', '1x8', '1x16', '1x32', '1x64']).optional(),
    topology: z.enum(['BALANCED', 'UNBALANCED']).optional(),
    tapPercent: z.coerce.number().int().min(1).max(50).optional(),
    /** DIO/OLT: nº de portas BIDI (bandejas/PONs). */
    portsCount: z.coerce.number().int().min(1).max(576).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.type === 'SPLITTER' && !v.ratio) {
      ctx.addIssue({ code: 'custom', path: ['ratio'], message: 'splitter exige razão' });
    }
    if (v.type === 'SPLITTER' && v.topology === 'UNBALANCED' && !v.tapPercent) {
      ctx.addIssue({
        code: 'custom',
        path: ['tapPercent'],
        message: 'desbalanceado exige tap_percent (spec §14.5)',
      });
    }
    if (v.type !== 'SPLITTER' && !v.portsCount) {
      ctx.addIssue({ code: 'custom', path: ['portsCount'], message: 'informe o nº de portas' });
    }
  });
export type CreateFibermapDeviceRequest = z.infer<
  typeof CreateFibermapDeviceRequestSchema
>;

export const UpdateFibermapDeviceRequestSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  /** Posição no diagrama (drag do editor — persiste em metadata). */
  diagramPos: z
    .object({ col: z.enum(['L', 'R']), order: z.coerce.number().int().min(0).max(999) })
    .nullish(),
});
export type UpdateFibermapDeviceRequest = z.infer<
  typeof UpdateFibermapDeviceRequestSchema
>;

// =============================================================================
// Fusão em sequência (spec §8.1 — "fibras 1-8 do A nas 1-8 do B")
// =============================================================================
export const BulkFuseRequestSchema = z.object({
  elementId: z.string().uuid(),
  aCableId: z.string().uuid(),
  aStartFiber: z.coerce.number().int().min(1),
  bCableId: z.string().uuid(),
  bStartFiber: z.coerce.number().int().min(1),
  count: z.coerce.number().int().min(1).max(144),
});
export type BulkFuseRequest = z.infer<typeof BulkFuseRequestSchema>;

export interface BulkFuseResponse {
  created: number;
  /** Pares pulados (ponta ocupada/inexistente) com o motivo. */
  skipped: Array<{ aFiber: number; bFiber: number; reason: string }>;
}

// =============================================================================
// Access point — resposta (read model do editor)
// =============================================================================
export type FibermapApFiberState =
  /** Extremidade/corte sem conexão — pílula clicável pra fundir. */
  | 'FREE'
  | 'CONNECTED'
  /** Fibra passa direto (sangria possível via tesoura) — spec §4. */
  | 'EXPRESS';

export interface FibermapApFiberEnd {
  /** 'A'|'B' (extremidade) ou 'U'|'D' (corte). */
  side: 'A' | 'B' | 'U' | 'D';
  cutId: string | null;
  state: 'FREE' | 'CONNECTED';
  connectionId: string | null;
}

export interface FibermapApFiber {
  id: string;
  fiberNumber: number;
  tubeNumber: number;
  color: string;
  status: 'DARK' | 'ACTIVE' | 'RESERVED' | 'BROKEN';
  /** EXPRESS ⇒ ends vazio; senão 1 (extremidade) ou 2 (corte U+D). */
  state: FibermapApFiberState;
  ends: FibermapApFiberEnd[];
}

export interface FibermapApCable {
  id: string;
  name: string;
  displayColor: string | null;
  fiberCount: number;
  colorStandard: 'ABNT' | 'EIA598';
  /** Como o cabo toca este elemento (define a seta → / ← / passagem). */
  relation: 'STARTS' | 'ENDS' | 'PASSES' | 'LOOP';
  tubes: Array<{ tubeNumber: number; color: string }>;
  fibers: FibermapApFiber[];
}

export interface FibermapApPort {
  id: string;
  role: 'IN' | 'OUT' | 'BIDI';
  portNumber: number;
  label: string | null;
  /** Ocupação por face: id da conexão ou null (C=conector, F=fusão). */
  faces: { C: string | null; F: string | null };
}

export interface FibermapApDevice {
  id: string;
  type: 'SPLITTER' | 'DIO' | 'OLT' | 'ONU_SHELF' | 'RACK';
  name: string;
  metadata: Record<string, unknown>;
  ports: FibermapApPort[];
}

/** Lado humano de uma conexão (tooltip/print 3 do Tomodat). */
export interface FibermapApConnectionSide {
  type: 'FIBER_END' | 'PORT';
  fiberId?: string;
  side?: 'A' | 'B' | 'U' | 'D';
  cutId?: string;
  portId?: string;
  /** Rótulos resolvidos pro tooltip. */
  cableName?: string;
  fiberNumber?: number;
  fiberColor?: string;
  deviceName?: string;
  portLabel?: string;
}

export interface FibermapApConnection {
  id: string;
  kind: 'FUSION' | 'CONNECTOR' | 'SPLITTER_PATH';
  lossDb: number | null;
  notes: string | null;
  a: FibermapApConnectionSide;
  b: FibermapApConnectionSide;
}

export interface FibermapAccessPointResponse {
  element: { id: string; name: string; type: string };
  cables: FibermapApCable[];
  devices: FibermapApDevice[];
  connections: FibermapApConnection[];
  /** Default de fusão vigente do tenant — badge quando lossDb é null. */
  defaultFusionLossDb: number;
  defaultConnectorLossDb: number;
}
