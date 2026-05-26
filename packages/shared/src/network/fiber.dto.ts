/**
 * DTOs do módulo Fiber — cabos de fibra (R3 OSP).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Doc de visão: docs/architecture/osp-network.md
 *
 * IMPORTANTE: o path é trafegado como `Array<{latitude, longitude}>` na API
 * (formato {lat,lng} usado no resto do app), mas armazenado como LineString
 * GeoJSON `[[lng, lat], ...]` no banco. Backend faz a conversão; nem cliente
 * nem service tocam GeoJSON direto.
 */
import { z } from 'zod';

// =============================================================================
// Enums
// =============================================================================
export const FiberCableTypeSchema = z.enum([
  'BACKBONE',
  'DISTRIBUTION',
  'DROP',
]);
export type FiberCableType = z.infer<typeof FiberCableTypeSchema>;

// Valores comuns de mercado FTTH. Não bloqueia exóticos — só ajuda a UI
// (Select com sugestões) e validação razoável.
export const COMMON_FIBER_COUNTS = [2, 6, 12, 24, 48, 96, 144, 288] as const;

// =============================================================================
// Helpers
// =============================================================================
const optionalNullableString = (max = 255) =>
  z.string().max(max).nullish().transform((v) => (v === '' ? null : v));

// Ponto {latitude, longitude} — formato consistente com o resto do app.
// Não usamos LineString GeoJSON direto na API.
export const PathPointSchema = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
});
export type PathPoint = z.infer<typeof PathPointSchema>;

// Array de pelo menos 2 pontos (LineString degenera com <2).
export const PathSchema = z.array(PathPointSchema).min(2).max(2000);

// =============================================================================
// Create
// =============================================================================
export const CreateFiberCableRequestSchema = z.object({
  code: z.string().min(1).max(40),
  type: FiberCableTypeSchema,
  /** 1..432. Valores comuns: 2, 6, 12, 24, 48, 96, 144, 288. */
  fiberCount: z.coerce.number().int().min(1).max(432),
  /** Polyline geográfica — pelo menos 2 pontos. */
  path: PathSchema,
  /**
   * Override de comprimento em metros. Quando omitido, backend calcula via
   * Haversine somando os trechos do path. Útil pra registrar "cabo frouxo"
   * onde a metragem real é maior que a distância em linha reta.
   */
  lengthMetersOverride: z.coerce.number().min(0).max(1_000_000).nullish(),
  notes: optionalNullableString(2000),
  isActive: z.coerce.boolean().default(true),
});
export type CreateFiberCableRequest = z.infer<
  typeof CreateFiberCableRequestSchema
>;

// =============================================================================
// Update
// =============================================================================
export const UpdateFiberCableRequestSchema =
  CreateFiberCableRequestSchema.partial();
export type UpdateFiberCableRequest = z.infer<
  typeof UpdateFiberCableRequestSchema
>;

// =============================================================================
// Response
// =============================================================================
export interface FiberCableResponse {
  id: string;
  tenantId: string;
  code: string;
  type: FiberCableType;
  fiberCount: number;
  path: PathPoint[];
  /** Sempre preenchido — calculado se override não for informado. */
  lengthMeters: number;
  /** True se operador setou override; false se foi cálculo automático. */
  lengthOverridden: boolean;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// =============================================================================
// List query
// =============================================================================
export const ListFiberCablesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  type: FiberCableTypeSchema.optional(),
  search: z.string().max(120).optional(),
});
export type ListFiberCablesQuery = z.infer<typeof ListFiberCablesQuerySchema>;
