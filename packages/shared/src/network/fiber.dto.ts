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
  /**
   * Caixas onde o cabo TERMINA. Pré-requisito pra vista esquemática
   * (R4.5b) e power budget (R5). Nullable — cabos podem ficar soltos
   * durante a construção da planta.
   */
  endpointAId: z.string().uuid().nullish(),
  endpointBId: z.string().uuid().nullish(),
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
export interface FiberCableEndpointRef {
  id: string;
  code: string;
  type: 'CTO' | 'NAP' | 'SPLITTER' | 'EMENDA' | 'RESERVA';
}

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
  endpointAId: string | null;
  endpointA: FiberCableEndpointRef | null;
  endpointBId: string | null;
  endpointB: FiberCableEndpointRef | null;
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
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
  type: FiberCableTypeSchema.optional(),
  search: z.string().max(120).optional(),
});
export type ListFiberCablesQuery = z.infer<typeof ListFiberCablesQuerySchema>;

// =============================================================================
// TIA-598 — código de cores de fibra óptica (padrão internacional)
// =============================================================================
// Sequência usada na indústria de cabos FTTH. Em campo, o técnico identifica
// a fibra pelo nome OU pela cor (a indústria gravou as 12 cores na memória).
// Ciclo se repete pra cabos >12: fibra 13 = azul de novo, mas tubo diferente.
//
// Em cabos loose-tube, as fibras vêm em TUBOS coloridos (mesma sequência) e
// cada tubo tem 12 fibras. Aqui simplificamos: índice global 1..fiberCount,
// cor calculada por (index - 1) % 12.
export const TIA598_COLORS = [
  { name: 'Azul',      hex: '#1e40af' },
  { name: 'Laranja',   hex: '#ea580c' },
  { name: 'Verde',     hex: '#16a34a' },
  { name: 'Marrom',    hex: '#78350f' },
  { name: 'Cinza',     hex: '#6b7280' },
  { name: 'Branco',    hex: '#f3f4f6' },
  { name: 'Vermelho',  hex: '#dc2626' },
  { name: 'Preto',     hex: '#0f172a' },
  { name: 'Amarelo',   hex: '#facc15' },
  { name: 'Violeta',   hex: '#7c3aed' },
  { name: 'Rosa',      hex: '#ec4899' },
  { name: 'Aqua',      hex: '#06b6d4' },
] as const;

export interface FiberColor {
  name: string;
  hex: string;
  /** Tubo (1..N) — só pra cabos loose-tube (12+ fibras). */
  tube?: number;
}

/** Retorna cor + nome (e tubo se aplicável) pra uma fibra. */
export function fiberColor(index: number): FiberColor {
  if (index < 1) return { name: '—', hex: '#9ca3af' };
  const colorIdx = (index - 1) % 12;
  const tube = Math.floor((index - 1) / 12) + 1;
  return {
    name: TIA598_COLORS[colorIdx].name,
    hex: TIA598_COLORS[colorIdx].hex,
    tube: tube > 1 ? tube : undefined,
  };
}

// =============================================================================
// FiberSplice — Create
// =============================================================================
export const CreateFiberSpliceRequestSchema = z
  .object({
    latitude: z.coerce.number().min(-90).max(90),
    longitude: z.coerce.number().min(-180).max(180),
    cableAId: z.string().uuid(),
    fiberAIndex: z.coerce.number().int().min(1).max(432),
    cableBId: z.string().uuid(),
    fiberBIndex: z.coerce.number().int().min(1).max(432),
    /** Loss em dB. null = não medido. */
    lossDb: z.coerce.number().min(0).max(99.99).nullish(),
    photoUrl: z
      .string()
      .url()
      .max(2000)
      .nullish()
      .transform((v) => (v === '' ? null : v)),
    measuredAt: z
      .string()
      .datetime()
      .nullish()
      .transform((v) => (v === '' ? null : v)),
    notes: z
      .string()
      .max(2000)
      .nullish()
      .transform((v) => (v === '' ? null : v)),
  })
  .superRefine((data, ctx) => {
    // Fusão da mesma fibra com ela mesma é nonsense (DB também bloqueia, mas
    // validamos cedo pra erro melhor na UI).
    if (
      data.cableAId === data.cableBId &&
      data.fiberAIndex === data.fiberBIndex
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['fiberBIndex'],
        message: 'Fibra não pode ser fundida com ela mesma',
      });
    }
  });
export type CreateFiberSpliceRequest = z.infer<
  typeof CreateFiberSpliceRequestSchema
>;

// =============================================================================
// FiberSplice — Update
// =============================================================================
export const UpdateFiberSpliceRequestSchema = z
  .object({
    latitude: z.coerce.number().min(-90).max(90).optional(),
    longitude: z.coerce.number().min(-180).max(180).optional(),
    cableAId: z.string().uuid().optional(),
    fiberAIndex: z.coerce.number().int().min(1).max(432).optional(),
    cableBId: z.string().uuid().optional(),
    fiberBIndex: z.coerce.number().int().min(1).max(432).optional(),
    lossDb: z.coerce.number().min(0).max(99.99).nullish(),
    photoUrl: z
      .string()
      .url()
      .max(2000)
      .nullish()
      .transform((v) => (v === '' ? null : v)),
    measuredAt: z
      .string()
      .datetime()
      .nullish()
      .transform((v) => (v === '' ? null : v)),
    notes: z
      .string()
      .max(2000)
      .nullish()
      .transform((v) => (v === '' ? null : v)),
  })
  .strict();
export type UpdateFiberSpliceRequest = z.infer<
  typeof UpdateFiberSpliceRequestSchema
>;

// =============================================================================
// FiberSplice — Response
// =============================================================================
export interface FiberSpliceSummary {
  id: string;
  code: string;
  type: FiberCableType;
  fiberCount: number;
}

export interface FiberSpliceResponse {
  id: string;
  tenantId: string;
  latitude: number;
  longitude: number;
  cableAId: string;
  fiberAIndex: number;
  /** Cor TIA-598 da fibra A (denormalizada pra UI não recomputar). */
  fiberAColor: FiberColor;
  cableA: FiberSpliceSummary;
  cableBId: string;
  fiberBIndex: number;
  fiberBColor: FiberColor;
  cableB: FiberSpliceSummary;
  lossDb: number | null;
  /** Classificação da medida pra UI. */
  lossClass: 'unmeasured' | 'good' | 'warning' | 'bad';
  photoUrl: string | null;
  measuredAt: string | null;
  measuredById: string | null;
  measuredBy: { firstName: string; lastName: string } | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Classificação visual (verde/amarelo/vermelho) da perda na fusão.
 * Limites são heurísticos de campo, não normativos.
 */
export function classifyLoss(lossDb: number | null): FiberSpliceResponse['lossClass'] {
  if (lossDb == null) return 'unmeasured';
  if (lossDb < 0.2) return 'good'; // padrão ITU é 0.1; <0.2 = OK
  if (lossDb < 0.5) return 'warning'; // aceitável mas merece atenção
  return 'bad'; // refazer
}

// =============================================================================
// List query
// =============================================================================
export const ListFiberSplicesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(100),
  /** Filtra splices envolvendo este cabo (em A ou B). */
  cableId: z.string().uuid().optional(),
});
export type ListFiberSplicesQuery = z.infer<
  typeof ListFiberSplicesQuerySchema
>;
