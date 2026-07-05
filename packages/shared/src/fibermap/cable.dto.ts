/**
 * FiberMap — DTOs de cabos, segmentos e reservas (FM-2, spec §3.4, §6, §7).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Convenções:
 *  - API trafega rota como Array<{latitude, longitude}> (padrão do app);
 *    o banco guarda GeoJSON [[lng,lat],…] e a trigger PostGIS calcula geom +
 *    comprimento geográfico.
 *  - GET /cables?bbox= responde FeatureCollection<LineString> POR SEGMENTO
 *    (o MapLibre pinta cada segmento; properties carregam o cabo).
 *  - Comprimento óptico = coalesce(medido, geográfico × excessFactor) somado
 *    às reservas técnicas (spec §5.2) — quem exibe é o detail.
 */
import { z } from 'zod';

const optionalNullableString = (max = 255) =>
  z.string().max(max).nullish().transform((v) => (v === '' ? null : v));

export const FibermapPathPointSchema = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
});
export type FibermapPathPoint = z.infer<typeof FibermapPathPointSchema>;

/** Rota com pelo menos 2 vértices (LineString degenera com <2). */
export const FibermapPathSchema = z.array(FibermapPathPointSchema).min(2).max(2000);

// =============================================================================
// Cabo (instância a partir de modelo do catálogo — spec §6 "Cables")
// =============================================================================
export const CreateFibermapCableRequestSchema = z.object({
  folderId: z.string().uuid(),
  name: z.string().min(1).max(160),
  /** Produto type=CABLE — snapshot + tubos + fibras criados automaticamente. */
  productId: z.string().uuid(),
  /** Cor da polyline (#rrggbb). Omitido = derivada do nome. */
  displayColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullish(),
  notes: optionalNullableString(2000),
});
export type CreateFibermapCableRequest = z.infer<
  typeof CreateFibermapCableRequestSchema
>;

export const UpdateFibermapCableRequestSchema = z.object({
  folderId: z.string().uuid().optional(),
  name: z.string().min(1).max(160).optional(),
  displayColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullish(),
  notes: optionalNullableString(2000),
  /** Calibração por instância (spec §14.10) — nunca altera o produto. */
  excessFactor: z.coerce.number().min(1).max(1.5).optional(),
});
export type UpdateFibermapCableRequest = z.infer<
  typeof UpdateFibermapCableRequestSchema
>;

// =============================================================================
// Segmentos (cadeia contígua — spec §14.4)
// =============================================================================
export const CreateFibermapSegmentRequestSchema = z.object({
  fromElementId: z.string().uuid(),
  toElementId: z.string().uuid(),
  /** Vértices da rota; o service força path[0]/path[fim] nas coords dos elementos. */
  path: FibermapPathSchema,
  /** Metragem de bobina/OTDR (override do geográfico). */
  measuredLengthM: z.coerce.number().positive().max(1_000_000).nullish(),
});
export type CreateFibermapSegmentRequest = z.infer<
  typeof CreateFibermapSegmentRequestSchema
>;

export const UpdateFibermapSegmentRequestSchema = z.object({
  path: FibermapPathSchema.optional(),
  measuredLengthM: z.coerce.number().positive().max(1_000_000).nullish(),
});
export type UpdateFibermapSegmentRequest = z.infer<
  typeof UpdateFibermapSegmentRequestSchema
>;

// =============================================================================
// Reservas técnicas (spec §2 — contam na distância ÓPTICA)
// =============================================================================
export const CreateFibermapSlackRequestSchema = z.object({
  elementId: z.string().uuid(),
  segmentId: z.string().uuid(),
  lengthM: z.coerce.number().positive().max(10_000),
});
export type CreateFibermapSlackRequest = z.infer<
  typeof CreateFibermapSlackRequestSchema
>;

// =============================================================================
// List (bbox → FeatureCollection<LineString> por segmento)
// =============================================================================
export const ListFibermapCablesQuerySchema = z.object({
  /** Mesmo formato do /elements: "minLng,minLat,maxLng,maxLat". */
  bbox: z.string(),
  folderId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(5000).default(2000),
});
export type ListFibermapCablesQuery = z.infer<typeof ListFibermapCablesQuerySchema>;

export interface FibermapSegmentFeatureProperties {
  segmentId: string;
  cableId: string;
  cableName: string;
  seq: number;
  displayColor: string;
  fiberCount: number;
  geometricLengthM: number;
  measuredLengthM: number | null;
  opticalLengthM: number;
}

export interface FibermapCablesFeatureCollection {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    geometry: { type: 'LineString'; coordinates: [number, number][] };
    properties: FibermapSegmentFeatureProperties;
  }>;
  truncated: boolean;
}

// =============================================================================
// Responses
// =============================================================================
export interface FibermapSlackResponse {
  id: string;
  elementId: string;
  elementName: string;
  segmentId: string;
  lengthM: number;
  createdAt: string;
}

export interface FibermapSegmentResponse {
  id: string;
  seq: number;
  fromElementId: string;
  fromElementName: string;
  toElementId: string;
  toElementName: string;
  path: FibermapPathPoint[];
  geometricLengthM: number;
  measuredLengthM: number | null;
  /** coalesce(medido, geográfico × excessFactor) — SEM reservas. */
  opticalLengthM: number;
  slacks: FibermapSlackResponse[];
}

export interface FibermapCableOccupancy {
  total: number;
  dark: number;
  active: number;
  reserved: number;
  broken: number;
}

export interface FibermapCableResponse {
  id: string;
  folderId: string;
  name: string;
  productId: string | null;
  productName: string | null;
  fiberCount: number;
  tubeCount: number;
  fibersPerTube: number;
  colorStandard: 'ABNT' | 'EIA598';
  excessFactor: number;
  displayColor: string | null;
  notes: string | null;
  tubes: Array<{ tubeNumber: number; color: string }>;
  segments: FibermapSegmentResponse[];
  occupancy: FibermapCableOccupancy;
  /** Somatórios do cabo inteiro. */
  totalGeometricM: number;
  /** Σ óptico dos segmentos + Σ reservas (spec §5.2). */
  totalOpticalM: number;
  totalSlackM: number;
  createdAt: string;
  updatedAt: string;
}

/** Cabos cuja PONTA FINAL é um elemento — pra "continuar cabo" no desenho. */
export interface FibermapCableStub {
  id: string;
  name: string;
  fiberCount: number;
  displayColor: string | null;
  /** Elemento onde o cabo termina hoje (to do último segmento). */
  tailElementId: string | null;
  segmentsCount: number;
}
