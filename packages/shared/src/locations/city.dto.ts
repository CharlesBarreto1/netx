import { z } from 'zod';

/**
 * Cidade operada pelo ISP (por tenant). Carrega o código IBGE do município
 * (FK pra referência nacional) — base do autocomplete e do fiscal.
 */
export const CreateCityRequestSchema = z.object({
  ibgeCode: z.string().length(7).regex(/^\d{7}$/, 'Código IBGE inválido'),
  name: z.string().min(1).max(120),
  uf: z.string().length(2).toUpperCase(),
  active: z.boolean().default(true),
  latitude: z.coerce.number().min(-90).max(90).nullish(),
  longitude: z.coerce.number().min(-180).max(180).nullish(),
});
export type CreateCityRequest = z.infer<typeof CreateCityRequestSchema>;

export const UpdateCityRequestSchema = CreateCityRequestSchema.partial().omit({
  ibgeCode: true, // IBGE não muda; troque a cidade se errou
});
export type UpdateCityRequest = z.infer<typeof UpdateCityRequestSchema>;

export interface CityResponse {
  id: string;
  ibgeCode: string;
  name: string;
  uf: string;
  active: boolean;
  latitude: number | null;
  longitude: number | null;
  createdAt: string;
  updatedAt: string;
}
