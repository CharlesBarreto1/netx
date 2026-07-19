/**
 * FiberMap — DTOs de elementos físicos (nós geográficos, spec §3.3, §6, §7).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * O GET de mapa é SEMPRE por bbox do viewport (spec §6/§16) e responde
 * GeoJSON FeatureCollection<Point> — o MapLibre consome direto como source.
 * Coordenadas GeoJSON são [lng, lat] (RFC 7946).
 */
import { z } from 'zod';

const optionalNullableString = (max = 255) =>
  z.string().max(max).nullish().transform((v) => (v === '' ? null : v));

export const FibermapElementTypeSchema = z.enum([
  'POP',
  'CABINET',
  'CEO',
  'CTO',
  'POLE',
  'SLACK_COIL',
  'CUSTOMER_PREMISE',
]);
export type FibermapElementType = z.infer<typeof FibermapElementTypeSchema>;

const LatitudeSchema = z.coerce.number().min(-90).max(90);
const LongitudeSchema = z.coerce.number().min(-180).max(180);

// =============================================================================
// Create / Update
// =============================================================================
export const CreateFibermapElementRequestSchema = z.object({
  folderId: z.string().uuid(),
  type: FibermapElementTypeSchema,
  /** Produto do catálogo — a UI obriga pra CEO/CTO/CABINET (spec §3.3). */
  productId: z.string().uuid().nullish(),
  /**
   * POP da planta de rede (Técnico > Planta de rede) que este elemento
   * representa. Só aceito em type=POP — o service rejeita nos demais. Um POP
   * do inventário só pode estar em um elemento vivo.
   */
  netxPopId: z.string().uuid().nullish(),
  name: z.string().min(1).max(120),
  latitude: LatitudeSchema,
  longitude: LongitudeSchema,
  address: optionalNullableString(255),
  description: optionalNullableString(2000),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type CreateFibermapElementRequest = z.infer<
  typeof CreateFibermapElementRequestSchema
>;

export const UpdateFibermapElementRequestSchema = z.object({
  folderId: z.string().uuid().optional(),
  productId: z.string().uuid().nullish(),
  /** null explícito desvincula o POP; undefined mantém como está. */
  netxPopId: z.string().uuid().nullish(),
  name: z.string().min(1).max(120).optional(),
  latitude: LatitudeSchema.optional(),
  longitude: LongitudeSchema.optional(),
  address: optionalNullableString(255),
  description: optionalNullableString(2000),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type UpdateFibermapElementRequest = z.infer<
  typeof UpdateFibermapElementRequestSchema
>;

// =============================================================================
// List (bbox GeoJSON) / Search
// =============================================================================
/** bbox "minLng,minLat,maxLng,maxLat" (ordem do MapLibre getBounds). */
export const FibermapBboxSchema = z
  .string()
  .transform((raw, ctx) => {
    const parts = raw.split(',').map((p) => Number(p.trim()));
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
      ctx.addIssue({
        code: 'custom',
        message: 'bbox deve ser "minLng,minLat,maxLng,maxLat"',
      });
      return z.NEVER;
    }
    const [minLng, minLat, maxLng, maxLat] = parts;
    if (
      minLng < -180 || maxLng > 180 || minLat < -90 || maxLat > 90 ||
      minLng >= maxLng || minLat >= maxLat
    ) {
      ctx.addIssue({ code: 'custom', message: 'bbox fora de faixa/invertido' });
      return z.NEVER;
    }
    return [minLng, minLat, maxLng, maxLat] as [number, number, number, number];
  });

export const ListFibermapElementsQuerySchema = z.object({
  /** Obrigatório — o mapa nunca carrega a planta inteira (spec §6). */
  bbox: FibermapBboxSchema,
  /** CSV de tipos: "CEO,CTO". Vazio = todos. */
  types: z
    .string()
    .optional()
    .transform((raw, ctx) => {
      if (!raw) return undefined;
      const list = raw.split(',').map((t) => t.trim()).filter(Boolean);
      const bad = list.filter(
        (t) => !FibermapElementTypeSchema.options.includes(t as never),
      );
      if (bad.length) {
        ctx.addIssue({ code: 'custom', message: `tipos inválidos: ${bad.join(',')}` });
        return z.NEVER;
      }
      return list as FibermapElementType[];
    }),
  folderId: z.string().uuid().optional(),
  /** Teto de features por resposta (proteção; UI usa cluster em zoom baixo). */
  limit: z.coerce.number().int().min(1).max(10_000).default(4000),
});
export type ListFibermapElementsQuery = z.infer<
  typeof ListFibermapElementsQuerySchema
>;

export const SearchFibermapElementsQuerySchema = z.object({
  q: z.string().min(2).max(80),
  limit: z.coerce.number().int().min(1).max(50).default(12),
});
export type SearchFibermapElementsQuery = z.infer<
  typeof SearchFibermapElementsQuerySchema
>;

// =============================================================================
// Responses
// =============================================================================
export interface FibermapElementFeatureProperties {
  id: string;
  type: FibermapElementType;
  name: string;
  folderId: string;
  productId: string | null;
  productName: string | null;
  photosCount: number;
  devicesCount: number;
}

export interface FibermapElementFeature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: FibermapElementFeatureProperties;
}

export interface FibermapElementsFeatureCollection {
  type: 'FeatureCollection';
  features: FibermapElementFeature[];
  /** true se o bbox tinha mais elementos que `limit` (UI avisa/agrupa). */
  truncated: boolean;
}

export interface FibermapElementSearchHit {
  id: string;
  type: FibermapElementType;
  name: string;
  latitude: number;
  longitude: number;
  folderId: string;
}

export interface FibermapElementPhotoResponse {
  id: string;
  fileName: string | null;
  caption: string | null;
  takenAt: string | null;
  createdAt: string;
}

export interface FibermapElementResponse {
  id: string;
  folderId: string;
  type: FibermapElementType;
  productId: string | null;
  product: {
    id: string;
    name: string;
    manufacturer: string;
    specs: Record<string, unknown>;
  } | null;
  /** POP da planta de rede que este elemento representa (só type=POP). */
  netxPopId: string | null;
  netxPop: {
    id: string;
    name: string;
    code: string | null;
    city: string | null;
  } | null;
  name: string;
  latitude: number;
  longitude: number;
  address: string | null;
  description: string | null;
  metadata: Record<string, unknown>;
  photos: FibermapElementPhotoResponse[];
  devicesCount: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * GET /fibermap/pops — POPs da planta de rede com onde já estão na planta
 * óptica. Exposto sob fibermap.read (a listagem /v1/network/pops exige
 * network.read, que o operador de planta pode não ter).
 */
export interface FibermapInventoryPop {
  id: string;
  name: string;
  code: string | null;
  city: string | null;
  state: string | null;
  /** Coordenada do POP no inventário — sugestão pra posicionar no mapa. */
  latitude: number | null;
  longitude: number | null;
  /** null = livre pra colocar no mapa. */
  placement: {
    elementId: string;
    elementName: string;
    folderId: string;
  } | null;
}

// =============================================================================
// Fotos (MinIO presigned — 2 passos, mesmo fluxo de O.S/RH)
// =============================================================================
export const PresignFibermapPhotoRequestSchema = z.object({
  fileName: z.string().min(1).max(200),
  contentType: z
    .string()
    .regex(/^image\/(jpeg|png|webp|heic|heif)$/i, 'apenas imagens'),
});
export type PresignFibermapPhotoRequest = z.infer<
  typeof PresignFibermapPhotoRequestSchema
>;

export const RegisterFibermapPhotoRequestSchema = z.object({
  storageKey: z.string().min(1).max(512),
  fileName: optionalNullableString(255),
  caption: optionalNullableString(255),
  takenAt: z.coerce.date().nullish(),
});
export type RegisterFibermapPhotoRequest = z.infer<
  typeof RegisterFibermapPhotoRequestSchema
>;
