/**
 * FiberMap — DTOs do catálogo de produtos (Tela 3, spec §3.2 e §10).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Tudo que existe no mapa é instância de um produto do catálogo. Um produto
 * define características uma vez (fabricante, modelo, estrutura); instâncias
 * herdam por SNAPSHOT na criação — editar o produto depois NÃO altera
 * instâncias existentes (spec §14.8: produto com instâncias nunca é excluído,
 * apenas desativado).
 */
import { z } from 'zod';
import {
  FIBERMAP_COLOR_CODES,
  FIBERMAP_COLOR_STANDARDS,
  FIBERMAP_TUBE_SCHEMES,
} from './colors';

// =============================================================================
// Enums
// =============================================================================
export const FibermapProductTypeSchema = z.enum([
  'CABLE',
  'SPLICE_CLOSURE', // CEO
  'TERMINATION_BOX', // CTO
  'DIO',
  'CABINET', // Armário de rua
  'INDOOR_RACK',
  'SPLITTER',
]);
export type FibermapProductType = z.infer<typeof FibermapProductTypeSchema>;

export const FibermapColorCodeSchema = z.enum(FIBERMAP_COLOR_CODES);
export const FibermapColorStandardSchema = z.enum(FIBERMAP_COLOR_STANDARDS);
export const FibermapTubeSchemeSchema = z.enum(FIBERMAP_TUBE_SCHEMES);

// =============================================================================
// Helpers
// =============================================================================
const optionalNullableString = (max = 255) =>
  z.string().max(max).nullish().transform((v) => (v === '' ? null : v));

/**
 * Chaves de `specs` documentadas por tipo (spec §3.2) — validação LEVE:
 * aceita objeto livre, mas normaliza os campos conhecidos quando presentes.
 * A UI usa os campos conhecidos pra montar os forms por categoria.
 */
export const FibermapProductSpecsSchema = z
  .object({
    // SPLICE_CLOSURE (CEO)
    trays: z.coerce.number().int().min(0).max(64).optional(),
    splices_per_tray: z.coerce.number().int().min(0).max(144).optional(),
    cable_entries: z.coerce.number().int().min(0).max(64).optional(),
    mount: z.enum(['AEREA', 'SUBTERRANEA']).optional(),
    // TERMINATION_BOX (CTO)
    drop_ports: z.coerce.number().int().min(0).max(144).optional(),
    connector: z.string().max(40).optional(),
    supports_splitter: z.coerce.boolean().optional(),
    splice_capacity: z.coerce.number().int().min(0).max(144).optional(),
    // DIO
    ports: z.coerce.number().int().min(0).max(576).optional(),
    rack_units: z.coerce.number().int().min(0).max(60).optional(),
    // CABINET
    outdoor: z.coerce.boolean().optional(),
    // SPLITTER
    ratio: z
      .enum(['1x2', '1x4', '1x8', '1x16', '1x32', '1x64'])
      .optional(),
    topology: z.enum(['BALANCED', 'UNBALANCED']).optional(),
    tap_percent: z.coerce.number().int().min(1).max(50).optional(),
    connectorized: z.coerce.boolean().optional(),
  })
  // Chaves extras passam intactas (validação leve, spec §3.2).
  .catchall(z.unknown());
export type FibermapProductSpecs = z.infer<typeof FibermapProductSpecsSchema>;

// =============================================================================
// Produto (categorias não-cabo)
// =============================================================================
export const CreateFibermapProductRequestSchema = z.object({
  type: FibermapProductTypeSchema,
  manufacturer: z.string().max(120).default('Padrão'),
  name: z.string().min(1).max(160),
  description: optionalNullableString(2000),
  specs: FibermapProductSpecsSchema.default({}),
});
export type CreateFibermapProductRequest = z.infer<
  typeof CreateFibermapProductRequestSchema
>;

// Remove defaults no PATCH: no Zod 4 o `.partial()` ainda injeta o default de
// campo ausente (mesma pegadinha documentada em network/fiber.dto.ts) — sem o
// extend abaixo, um PATCH sem `specs` APAGARIA os specs pra {}.
export const UpdateFibermapProductRequestSchema =
  CreateFibermapProductRequestSchema.omit({ type: true })
    .partial()
    .extend({
      manufacturer: z.string().max(120).optional(),
      specs: FibermapProductSpecsSchema.optional(),
    });
export type UpdateFibermapProductRequest = z.infer<
  typeof UpdateFibermapProductRequestSchema
>;

// =============================================================================
// Modelo de cabo (produto CABLE + extensão estruturada, spec §3.2)
// =============================================================================
export const CreateFibermapCableModelRequestSchema = z
  .object({
    manufacturer: z.string().max(120).default('Padrão'),
    name: z.string().min(1).max(160),
    description: optionalNullableString(2000),
    fiberCount: z.coerce.number().int().min(1).max(1728),
    tubeCount: z.coerce.number().int().min(1).max(144),
    fibersPerTube: z.coerce.number().int().min(1).max(48),
    colorStandard: FibermapColorStandardSchema.default('ABNT'),
    tubeScheme: FibermapTubeSchemeSchema.default('STANDARD_CYCLE'),
    /** Obrigatório quando tubeScheme=CUSTOM: uma cor por tubo, na ordem. */
    customTubeColors: z.array(FibermapColorCodeSchema).max(144).optional(),
    /** Fator de excesso (catenária + helicoidal), default 1,02 (spec §2). */
    excessFactor: z.coerce.number().min(1).max(1.5).default(1.02),
    /** Classe informativa: 'ASU80', 'ASU120', 'DROP', 'SUBTERRANEO'… */
    cableClass: optionalNullableString(40),
  })
  .superRefine((v, ctx) => {
    if (v.fiberCount !== v.tubeCount * v.fibersPerTube) {
      ctx.addIssue({
        code: 'custom',
        path: ['fiberCount'],
        message: `fiberCount (${v.fiberCount}) deve ser tubeCount × fibersPerTube (${v.tubeCount} × ${v.fibersPerTube} = ${v.tubeCount * v.fibersPerTube})`,
      });
    }
    if (v.tubeScheme === 'CUSTOM') {
      if (!v.customTubeColors || v.customTubeColors.length !== v.tubeCount) {
        ctx.addIssue({
          code: 'custom',
          path: ['customTubeColors'],
          message: `tubeScheme=CUSTOM exige customTubeColors com exatamente ${v.tubeCount} cores`,
        });
      }
    }
  });
export type CreateFibermapCableModelRequest = z.infer<
  typeof CreateFibermapCableModelRequestSchema
>;

// =============================================================================
// Responses
// =============================================================================
export interface FibermapCableModelTubeResponse {
  tubeNumber: number;
  color: string;
}

export interface FibermapCableModelResponse {
  fiberCount: number;
  tubeCount: number;
  fibersPerTube: number;
  colorStandard: 'ABNT' | 'EIA598';
  tubeScheme: 'STANDARD_CYCLE' | 'PILOT_DIRECTIONAL' | 'CUSTOM';
  excessFactor: number;
  cableClass: string | null;
  tubes: FibermapCableModelTubeResponse[];
}

export interface FibermapProductResponse {
  id: string;
  type: FibermapProductType;
  manufacturer: string;
  name: string;
  description: string | null;
  specs: Record<string, unknown>;
  isActive: boolean;
  /** Nº de instâncias em campo (elementos/cabos/devices criados dele). */
  instancesCount?: number;
  /** Presente apenas quando type=CABLE. */
  cableModel?: FibermapCableModelResponse | null;
  createdAt: string;
  updatedAt: string;
}

// =============================================================================
// List query
// =============================================================================
export const ListFibermapProductsQuerySchema = z.object({
  type: FibermapProductTypeSchema.optional(),
  q: z.string().max(160).optional(),
  active: z
    .enum(['true', 'false', 'all'])
    .default('true')
    .transform((v) => (v === 'all' ? undefined : v === 'true')),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListFibermapProductsQuery = z.infer<
  typeof ListFibermapProductsQuerySchema
>;

// =============================================================================
// Defaults de atenuação (spec §5.3 — seed obrigatório, editável na Tela 3)
// =============================================================================
/**
 * Chaves estáveis da tabela de atenuação. Valores em dB, exceto FIBER_* que
 * são dB/km. UNBALANCED_{p}_TAP/PASS: perda do ramo tap (p%) e do passante.
 */
export const FIBERMAP_ATTENUATION_KEYS = [
  'FIBER_1310',
  'FIBER_1490',
  'FIBER_1550',
  'FUSION',
  'CONNECTOR_PAIR',
  'SPLITTER_1_2',
  'SPLITTER_1_4',
  'SPLITTER_1_8',
  'SPLITTER_1_16',
  'SPLITTER_1_32',
  'SPLITTER_1_64',
  'UNBALANCED_10_TAP',
  'UNBALANCED_10_PASS',
  'UNBALANCED_20_TAP',
  'UNBALANCED_20_PASS',
  'UNBALANCED_30_TAP',
  'UNBALANCED_30_PASS',
  'UNBALANCED_50_TAP',
  'UNBALANCED_50_PASS',
] as const;
export type FibermapAttenuationKey = (typeof FIBERMAP_ATTENUATION_KEYS)[number];

/** Defaults de fábrica (spec §5.3). dB/km pra FIBER_*, dB pro resto. */
export const FIBERMAP_ATTENUATION_DEFAULTS: Record<FibermapAttenuationKey, number> = {
  FIBER_1310: 0.35,
  FIBER_1490: 0.28,
  FIBER_1550: 0.22,
  FUSION: 0.1,
  CONNECTOR_PAIR: 0.5,
  SPLITTER_1_2: 3.7,
  SPLITTER_1_4: 7.3,
  SPLITTER_1_8: 10.5,
  SPLITTER_1_16: 13.7,
  SPLITTER_1_32: 17.1,
  SPLITTER_1_64: 20.4,
  UNBALANCED_10_TAP: 10.5,
  UNBALANCED_10_PASS: 0.8,
  UNBALANCED_20_TAP: 7.4,
  UNBALANCED_20_PASS: 1.2,
  UNBALANCED_30_TAP: 5.7,
  UNBALANCED_30_PASS: 1.9,
  UNBALANCED_50_TAP: 3.7,
  UNBALANCED_50_PASS: 3.7,
};

export const FibermapAttenuationKeySchema = z.enum(FIBERMAP_ATTENUATION_KEYS);

export function isFibermapAttenuationKey(v: string): v is FibermapAttenuationKey {
  return (FIBERMAP_ATTENUATION_KEYS as readonly string[]).includes(v);
}

// z.record com chave string (padrão do repo) + validação de chaves no
// superRefine — atualização PARCIAL (só as chaves editadas).
export const PatchFibermapAttenuationRequestSchema = z.object({
  values: z
    .record(z.string(), z.coerce.number().min(0).max(60))
    .superRefine((v, ctx) => {
      const keys = Object.keys(v);
      if (keys.length === 0) {
        ctx.addIssue({ code: 'custom', message: 'informe ao menos uma chave' });
      }
      for (const k of keys) {
        if (!isFibermapAttenuationKey(k)) {
          ctx.addIssue({
            code: 'custom',
            path: [k],
            message: `chave de atenuação desconhecida: ${k}`,
          });
        }
      }
    }),
});
export type PatchFibermapAttenuationRequest = z.infer<
  typeof PatchFibermapAttenuationRequestSchema
>;

export interface FibermapAttenuationResponse {
  /** Mapa chave → valor vigente (default de fábrica se nunca editado). */
  values: Record<FibermapAttenuationKey, number>;
  /** Chaves que o tenant sobrescreveu (≠ default de fábrica). */
  overridden: FibermapAttenuationKey[];
}
