/**
 * DTOs do módulo NetworkFolder — organização administrativa da planta (R4.5e).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Doc: docs/architecture/osp-network.md
 *
 * Pastas formam árvore (parentId auto-ref) — frontend monta o tree na UI.
 * Cada item (caixa OU cabo) tem 1 pasta opcional. Operador filtra mapa por
 * pastas pra ver só "a região dele".
 */
import { z } from 'zod';

const optionalNullableString = (max = 255) =>
  z.string().max(max).nullish().transform((v) => (v === '' ? null : v));

export const CreateNetworkFolderRequestSchema = z.object({
  parentId: z.string().uuid().nullish(),
  name: z.string().min(1).max(120),
  // Hex RGB (#rrggbb). null = sem cor (UI usa neutra).
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Cor inválida — use #rrggbb')
    .nullish(),
  position: z.coerce.number().int().min(0).max(100_000).optional(),
  notes: optionalNullableString(2000),
});
export type CreateNetworkFolderRequest = z.infer<
  typeof CreateNetworkFolderRequestSchema
>;

export const UpdateNetworkFolderRequestSchema =
  CreateNetworkFolderRequestSchema.partial();
export type UpdateNetworkFolderRequest = z.infer<
  typeof UpdateNetworkFolderRequestSchema
>;

export interface NetworkFolderResponse {
  id: string;
  tenantId: string;
  parentId: string | null;
  name: string;
  color: string | null;
  position: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  /** Contagem direta de itens (não recursiva — UI calcula totais subindo). */
  itemCounts: {
    enclosures: number;
    cables: number;
  };
}

/**
 * Atribui múltiplos itens a uma pasta de uma vez. POST /folders/:id/items.
 * Operador seleciona N caixas/cabos no mapa e arrasta pra pasta — backend
 * faz update em batch.
 */
export const AssignItemsToFolderRequestSchema = z.object({
  enclosureIds: z.array(z.string().uuid()).default([]),
  cableIds: z.array(z.string().uuid()).default([]),
});
export type AssignItemsToFolderRequest = z.infer<
  typeof AssignItemsToFolderRequestSchema
>;
