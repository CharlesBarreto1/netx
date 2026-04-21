import { z } from 'zod';

// -----------------------------------------------------------------------------
// Pipeline — funil comercial (container de estágios/colunas do Kanban)
// -----------------------------------------------------------------------------

const HexColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Cor deve ser hex no formato #RRGGBB');

// -----------------------------------------------------------------------------
// Stage (coluna do Kanban)
// -----------------------------------------------------------------------------
export const PipelineStageInputSchema = z.object({
  id: z.string().uuid().optional(), // presente em update — mantém estágio existente
  name: z.string().min(1).max(120),
  probability: z.coerce.number().int().min(0).max(100).default(0),
  color: HexColorSchema.nullish(),
  isWon: z.boolean().optional().default(false),
  isLost: z.boolean().optional().default(false),
});
export type PipelineStageInput = z.infer<typeof PipelineStageInputSchema>;

// -----------------------------------------------------------------------------
// Pipeline Create / Update
// -----------------------------------------------------------------------------
export const CreatePipelineRequestSchema = z.object({
  name: z.string().min(1).max(120),
  slug: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'Slug deve conter apenas letras minúsculas, números e hífens'),
  description: z.string().max(500).nullish(),
  color: HexColorSchema.nullish(),
  isDefault: z.boolean().optional().default(false),
  // Se não vier, o backend cria com um conjunto de estágios padrão.
  stages: z.array(PipelineStageInputSchema).min(1).max(20).optional(),
});
export type CreatePipelineRequest = z.infer<typeof CreatePipelineRequestSchema>;

export const UpdatePipelineRequestSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).nullish(),
  color: HexColorSchema.nullish(),
  isDefault: z.boolean().optional(),
  isArchived: z.boolean().optional(),
});
export type UpdatePipelineRequest = z.infer<typeof UpdatePipelineRequestSchema>;

// -----------------------------------------------------------------------------
// Stages — operações granulares (reorder + CRUD individual)
// -----------------------------------------------------------------------------
export const ReorderStagesRequestSchema = z.object({
  stageIds: z.array(z.string().uuid()).min(1), // nova ordem (posições implícitas no índice)
});
export type ReorderStagesRequest = z.infer<typeof ReorderStagesRequestSchema>;

export const CreateStageRequestSchema = PipelineStageInputSchema.omit({ id: true });
export type CreateStageRequest = z.infer<typeof CreateStageRequestSchema>;

export const UpdateStageRequestSchema = PipelineStageInputSchema.omit({ id: true }).partial();
export type UpdateStageRequest = z.infer<typeof UpdateStageRequestSchema>;

// -----------------------------------------------------------------------------
// Listagem
// -----------------------------------------------------------------------------
export const ListPipelinesQuerySchema = z.object({
  includeArchived: z.coerce.boolean().optional().default(false),
});
export type ListPipelinesQuery = z.infer<typeof ListPipelinesQuerySchema>;

// -----------------------------------------------------------------------------
// Response
// -----------------------------------------------------------------------------
export interface PipelineStageResponse {
  id: string;
  pipelineId: string;
  name: string;
  order: number;
  probability: number;
  color: string | null;
  isWon: boolean;
  isLost: boolean;
  dealCount?: number;     // populado quando ?withCounts=true
  dealTotalValue?: number;
  createdAt: string;
  updatedAt: string;
}

export interface PipelineResponse {
  id: string;
  tenantId: string;
  name: string;
  slug: string;
  description: string | null;
  color: string | null;
  isDefault: boolean;
  isArchived: boolean;
  stages: PipelineStageResponse[];
  createdAt: string;
  updatedAt: string;
}
