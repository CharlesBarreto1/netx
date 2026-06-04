import { z } from 'zod';

/**
 * Schemas Zod pra NetworkPop (POP = Point of Presence). Usados em
 * `@ZodBody(CreateNetworkPopRequestSchema)` no NetworkController pra que
 * inputs externos sejam validados antes de chegar no service — sem isso,
 * o `@Body() body: CreatePopInput` aceitava qualquer JSON.
 */

const optionalNullableString = (max = 255) =>
  z
    .string()
    .max(max)
    .nullish()
    .transform((v) => (v === '' ? null : v));

export const CreateNetworkPopRequestSchema = z.object({
  name: z.string().min(1).max(120),
  code: optionalNullableString(40),
  city: optionalNullableString(120),
  state: optionalNullableString(120),
  address: optionalNullableString(255),
  // Coordenadas pro mapa de Rede (módulo Mapeamento → Rede). Nullable
  // pra POPs antigos. Bounds globais; admin marca no LocationPicker.
  latitude: z.coerce.number().min(-90).max(90).nullish(),
  longitude: z.coerce.number().min(-180).max(180).nullish(),
  notes: optionalNullableString(2000),
  isActive: z.coerce.boolean().default(true),
});
export type CreateNetworkPopRequest = z.infer<typeof CreateNetworkPopRequestSchema>;

// Remove o default de isActive: no Zod 4 o `.partial()` ainda o injeta em PATCH
// sem o campo, reativando silenciosamente um POP desativado.
export const UpdateNetworkPopRequestSchema = CreateNetworkPopRequestSchema.partial().extend({
  isActive: CreateNetworkPopRequestSchema.shape.isActive.removeDefault().optional(),
});
export type UpdateNetworkPopRequest = z.infer<typeof UpdateNetworkPopRequestSchema>;
