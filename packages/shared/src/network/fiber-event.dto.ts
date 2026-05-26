/**
 * DTOs de FiberEvent — eventos OTDR (R6 OSP).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Doc: docs/architecture/osp-network.md
 *
 * Operador informa distância (km/m) lida do OTDR; backend calcula lat/lng
 * exato no path do cabo. Quando resolvedAt = null = evento ATIVO (pino
 * vermelho no mapa). Resolvido = cinza (histórico).
 */
import { z } from 'zod';

export const FiberEventTypeSchema = z.enum([
  'BREAK',
  'BEND',
  'REFLECTION',
  'ATTENUATION',
  'CONNECTOR',
  'OTHER',
]);
export type FiberEventType = z.infer<typeof FiberEventTypeSchema>;

const optionalNullableString = (max = 255) =>
  z.string().max(max).nullish().transform((v) => (v === '' ? null : v));

// =============================================================================
// Create
// =============================================================================
export const CreateFiberEventRequestSchema = z.object({
  cableId: z.string().uuid(),
  /**
   * Distância em METROS desde a origem (endpoint A) do cabo. UI aceita km
   * no campo do form e converte (1.520 km → 1520 m) antes de enviar.
   */
  distanceMeters: z.coerce.number().min(0).max(1_000_000),
  fiberIndex: z.coerce.number().int().min(1).max(432).nullish(),
  type: FiberEventTypeSchema,
  lossDb: z.coerce.number().min(0).max(99.99).nullish(),
  reportedAt: z
    .string()
    .datetime()
    .nullish()
    .transform((v) => (v === '' ? null : v)),
  photoUrl: z
    .string()
    .url()
    .max(2000)
    .nullish()
    .transform((v) => (v === '' ? null : v)),
  notes: optionalNullableString(2000),
});
export type CreateFiberEventRequest = z.infer<
  typeof CreateFiberEventRequestSchema
>;

// =============================================================================
// Update
// =============================================================================
export const UpdateFiberEventRequestSchema = z
  .object({
    distanceMeters: z.coerce.number().min(0).max(1_000_000).optional(),
    fiberIndex: z.coerce.number().int().min(1).max(432).nullish(),
    type: FiberEventTypeSchema.optional(),
    lossDb: z.coerce.number().min(0).max(99.99).nullish(),
    photoUrl: z.string().url().max(2000).nullish(),
    notes: optionalNullableString(2000),
  })
  .strict();
export type UpdateFiberEventRequest = z.infer<
  typeof UpdateFiberEventRequestSchema
>;

// =============================================================================
// Resolve (action) — marca como resolvido (preenche resolvedAt + resolvedById)
// =============================================================================
export const ResolveFiberEventRequestSchema = z.object({
  notes: optionalNullableString(2000),
});
export type ResolveFiberEventRequest = z.infer<
  typeof ResolveFiberEventRequestSchema
>;

// =============================================================================
// Response
// =============================================================================
export interface FiberEventResponse {
  id: string;
  tenantId: string;
  cableId: string;
  cable: { id: string; code: string; lengthMeters: number };
  distanceMeters: number;
  fiberIndex: number | null;
  latitude: number;
  longitude: number;
  type: FiberEventType;
  lossDb: number | null;
  reportedAt: string;
  reportedById: string | null;
  reportedBy: { firstName: string; lastName: string } | null;
  resolvedAt: string | null;
  resolvedById: string | null;
  resolvedBy: { firstName: string; lastName: string } | null;
  /** True quando resolvedAt = null (cor de mapa, badges). */
  isActive: boolean;
  photoUrl: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

// =============================================================================
// List query
// =============================================================================
export const ListFiberEventsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(100),
  cableId: z.string().uuid().optional(),
  type: FiberEventTypeSchema.optional(),
  /**
   * 'active' = só não-resolvidos (default — o que importa pra OS aberta).
   * 'resolved' = só resolvidos (histórico).
   * 'all' = ambos.
   */
  status: z.enum(['active', 'resolved', 'all']).default('active'),
});
export type ListFiberEventsQuery = z.infer<typeof ListFiberEventsQuerySchema>;
