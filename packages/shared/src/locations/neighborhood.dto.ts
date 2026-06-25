import { z } from 'zod';

/** Bairro de uma cidade (por tenant). */
export const CreateNeighborhoodRequestSchema = z.object({
  cityId: z.string().uuid(),
  name: z.string().min(1).max(120),
});
export type CreateNeighborhoodRequest = z.infer<
  typeof CreateNeighborhoodRequestSchema
>;

export const UpdateNeighborhoodRequestSchema =
  CreateNeighborhoodRequestSchema.partial().omit({ cityId: true });
export type UpdateNeighborhoodRequest = z.infer<
  typeof UpdateNeighborhoodRequestSchema
>;

export interface NeighborhoodResponse {
  id: string;
  cityId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}
