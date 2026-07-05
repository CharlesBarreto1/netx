/**
 * FiberMap — DTOs de pastas (árvore do painel esquerdo, spec §3.1 e §7).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Pastas organizam elementos e cabos (estilo Tomodat: CampoNet/NDC/Parceiros).
 * DELETE só com pasta vazia (spec §6). Elemento SEMPRE pertence a uma pasta.
 */
import { z } from 'zod';

const optionalNullableString = (max = 255) =>
  z.string().max(max).nullish().transform((v) => (v === '' ? null : v));

export const CreateFibermapFolderRequestSchema = z.object({
  name: z.string().min(1).max(120),
  parentId: z.string().uuid().nullish(),
  sortOrder: z.coerce.number().int().min(0).max(100_000).default(0),
});
export type CreateFibermapFolderRequest = z.infer<
  typeof CreateFibermapFolderRequestSchema
>;

export const UpdateFibermapFolderRequestSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  /** null = mover pra raiz. */
  parentId: z.string().uuid().nullish(),
  sortOrder: z.coerce.number().int().min(0).max(100_000).optional(),
  notes: optionalNullableString(2000),
});
export type UpdateFibermapFolderRequest = z.infer<
  typeof UpdateFibermapFolderRequestSchema
>;

export interface FibermapFolderResponse {
  id: string;
  parentId: string | null;
  name: string;
  sortOrder: number;
  /** Contagens pra árvore (chips por tipo virão com os elementos, FM-1). */
  elementsCount?: number;
  cablesCount?: number;
  children?: FibermapFolderResponse[];
  createdAt: string;
  updatedAt: string;
}
