import { z } from 'zod';

/**
 * Logradouro (rua/avenida) com CEP, por tenant. Nasce do lookup ViaCEP ou de
 * cadastro manual (cidades de CEP único). O número fica livre no contrato.
 */
export const CreateStreetRequestSchema = z.object({
  cityId: z.string().uuid(),
  neighborhoodId: z.string().uuid().nullish(),
  name: z.string().min(1).max(255),
  postalCode: z
    .string()
    .transform((s) => s.replace(/\D/g, ''))
    .refine((s) => s === '' || s.length === 8, { message: 'CEP deve ter 8 dígitos' })
    .transform((s) => (s === '' ? null : s))
    .nullish(),
  kind: z.string().max(40).nullish(), // Rua, Avenida, Travessa...
});
export type CreateStreetRequest = z.infer<typeof CreateStreetRequestSchema>;

export const UpdateStreetRequestSchema = CreateStreetRequestSchema.partial().omit(
  { cityId: true },
);
export type UpdateStreetRequest = z.infer<typeof UpdateStreetRequestSchema>;

export interface StreetResponse {
  id: string;
  cityId: string;
  neighborhoodId: string | null;
  name: string;
  postalCode: string | null;
  kind: string | null;
  createdAt: string;
  updatedAt: string;
}
