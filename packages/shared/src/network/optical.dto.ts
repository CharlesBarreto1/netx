/**
 * DTOs do módulo Optical — caixas ópticas (CTO/NAP/Splitter) + portas.
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Cobertura R2 do roadmap OSP. Doc de visão:
 *   docs/architecture/osp-network.md
 *
 * Enums espelham Prisma. Validação Zod no body de entrada (Create/Update);
 * Response é interface TS pura (backend serializa Decimal → number antes).
 */
import { z } from 'zod';

// =============================================================================
// Enums
// =============================================================================
export const OpticalEnclosureTypeSchema = z.enum([
  'CTO',
  'NAP',
  'SPLITTER',
  'EMENDA',
]);
export type OpticalEnclosureType = z.infer<typeof OpticalEnclosureTypeSchema>;

export const SplitterRatioSchema = z.enum([
  'ONE_TO_2',
  'ONE_TO_4',
  'ONE_TO_8',
  'ONE_TO_16',
  'ONE_TO_32',
  'ONE_TO_64',
]);
export type SplitterRatio = z.infer<typeof SplitterRatioSchema>;

export const OpticalMountTypeSchema = z.enum([
  'POSTE',
  'AEREO',
  'SUBTERRANEO',
  'PAREDE',
  'RACK',
]);
export type OpticalMountType = z.infer<typeof OpticalMountTypeSchema>;

export const OpticalPortStatusSchema = z.enum([
  'FREE',
  'RESERVED',
  'USED',
  'DAMAGED',
]);
export type OpticalPortStatus = z.infer<typeof OpticalPortStatusSchema>;

// Quantidade de portas inferida do ratio. Helper pra UI sugerir capacity.
// Caixas híbridas (CTO 1:8 + 8 portas extras = 16 total) podem ter capacity
// > ratio; daí o operador override.
export const SPLITTER_OUTPUT_COUNT: Record<SplitterRatio, number> = {
  ONE_TO_2: 2,
  ONE_TO_4: 4,
  ONE_TO_8: 8,
  ONE_TO_16: 16,
  ONE_TO_32: 32,
  ONE_TO_64: 64,
};

// Loss inserido pelo splitter (dB) — usado no R5 power budget. Valores
// ITU-T G.984.5 + margem prática. Tenant pode override em settings.
export const SPLITTER_LOSS_DB: Record<SplitterRatio, number> = {
  ONE_TO_2: 3.5,
  ONE_TO_4: 7.0,
  ONE_TO_8: 10.5,
  ONE_TO_16: 14.0,
  ONE_TO_32: 17.0,
  ONE_TO_64: 20.5,
};

// =============================================================================
// Helpers
// =============================================================================
const optionalNullableString = (max = 255) =>
  z.string().max(max).nullish().transform((v) => (v === '' ? null : v));

const latitudeSchema = z.coerce.number().min(-90).max(90);
const longitudeSchema = z.coerce.number().min(-180).max(180);

// =============================================================================
// OpticalEnclosure — Create
// =============================================================================
export const CreateOpticalEnclosureRequestSchema = z.object({
  code: z.string().min(1).max(40),
  type: OpticalEnclosureTypeSchema,
  /** Cascateamento — caixa-pai (CTO mãe → CTOs filhas). */
  parentId: z.string().uuid().nullish(),
  /** Geo obrigatória. Sem coord a caixa não aparece no mapa. */
  latitude: latitudeSchema,
  longitude: longitudeSchema,
  mountType: OpticalMountTypeSchema.nullish(),
  /**
   * Splitter ratio óptico. Só faz sentido em type=SPLITTER, ou em CTOs com
   * splitter embutido. Quando preenchido, R5 inclui no power budget.
   */
  splitterRatio: SplitterRatioSchema.nullish(),
  /** Número de portas físicas. Geralmente bate com o ratio; caixas híbridas variam. */
  capacity: z.coerce.number().int().min(1).max(256),
  locationLabel: optionalNullableString(255),
  notes: optionalNullableString(2000),
  isActive: z.coerce.boolean().default(true),
});
export type CreateOpticalEnclosureRequest = z.infer<
  typeof CreateOpticalEnclosureRequestSchema
>;

// =============================================================================
// OpticalEnclosure — Update
// =============================================================================
export const UpdateOpticalEnclosureRequestSchema =
  CreateOpticalEnclosureRequestSchema.partial();
export type UpdateOpticalEnclosureRequest = z.infer<
  typeof UpdateOpticalEnclosureRequestSchema
>;

// =============================================================================
// OpticalEnclosure — Response
// =============================================================================
export interface OpticalEnclosureResponse {
  id: string;
  tenantId: string;
  code: string;
  type: OpticalEnclosureType;
  parentId: string | null;
  latitude: number;
  longitude: number;
  mountType: OpticalMountType | null;
  splitterRatio: SplitterRatio | null;
  capacity: number;
  locationLabel: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  /** Contadores enriquecidos pelo backend pra UI (cor por ocupação no mapa). */
  stats?: {
    portsTotal: number;
    portsFree: number;
    portsReserved: number;
    portsUsed: number;
    portsDamaged: number;
    /** % ocupação (USED + RESERVED) sobre capacity. Pra colorir caixa no mapa. */
    occupancyPct: number;
  };
}

// =============================================================================
// OpticalPort — atribuir / reservar / liberar / marcar dano
// =============================================================================
/**
 * Mutação de uma porta. Server valida transições:
 *   FREE → RESERVED / USED / DAMAGED
 *   RESERVED → FREE / USED / DAMAGED
 *   USED → FREE (libera) / DAMAGED
 *   DAMAGED → FREE (após reparo)
 * Quando vai pra USED, contractId é obrigatório. Em qualquer outra direção,
 * contractId é setado pra null automaticamente.
 */
export const UpdateOpticalPortRequestSchema = z
  .object({
    status: OpticalPortStatusSchema,
    contractId: z.string().uuid().nullish(),
    notes: optionalNullableString(1000),
  })
  .superRefine((data, ctx) => {
    if (data.status === 'USED' && !data.contractId) {
      ctx.addIssue({
        code: 'custom',
        path: ['contractId'],
        message: 'Porta USED exige contractId',
      });
    }
  });
export type UpdateOpticalPortRequest = z.infer<
  typeof UpdateOpticalPortRequestSchema
>;

export interface OpticalPortResponse {
  id: string;
  tenantId: string;
  enclosureId: string;
  number: number;
  status: OpticalPortStatus;
  contractId: string | null;
  contract?: {
    id: string;
    code: string | null;
    customer: { id: string; displayName: string };
  } | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

// =============================================================================
// List query
// =============================================================================
export const ListOpticalEnclosuresQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  type: OpticalEnclosureTypeSchema.optional(),
  parentId: z.string().uuid().optional(),
  search: z.string().max(120).optional(),
});
export type ListOpticalEnclosuresQuery = z.infer<
  typeof ListOpticalEnclosuresQuerySchema
>;
