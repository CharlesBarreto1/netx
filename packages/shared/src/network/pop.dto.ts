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
  notes: optionalNullableString(2000),
  isActive: z.coerce.boolean().default(true),
});
export type CreateNetworkPopRequest = z.infer<typeof CreateNetworkPopRequestSchema>;

export const UpdateNetworkPopRequestSchema = CreateNetworkPopRequestSchema.partial();
export type UpdateNetworkPopRequest = z.infer<typeof UpdateNetworkPopRequestSchema>;
