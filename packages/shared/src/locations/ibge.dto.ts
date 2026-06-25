import { z } from 'zod';

/**
 * Referência nacional de municípios do IBGE (read-only, global). Usada no
 * autocomplete de cidade e como fonte do codMunicipio (7 dígitos) do fiscal.
 */
export interface IbgeMunicipalityResponse {
  codigo: string; // código IBGE, 7 dígitos
  nome: string;
  uf: string; // sigla, 2 letras
}

/** Query de busca de município por nome/UF. */
export const IbgeSearchQuerySchema = z.object({
  q: z.string().trim().min(2).max(120).optional(),
  uf: z.string().length(2).toUpperCase().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type IbgeSearchQuery = z.infer<typeof IbgeSearchQuerySchema>;

/**
 * Resposta normalizada de um lookup de CEP (ViaCEP). `erro` indica CEP
 * inexistente. Cidades de CEP único trazem logradouro/bairro vazios — nesses
 * casos o operador cadastra a rua manualmente.
 */
export interface CepLookupResponse {
  cep: string; // só dígitos (8)
  logradouro: string | null;
  complemento: string | null;
  bairro: string | null;
  localidade: string | null; // nome da cidade
  uf: string | null;
  ibge: string | null; // código IBGE do município (7 dígitos)
}

/** CEP: aceita com ou sem máscara, normaliza p/ 8 dígitos. */
export const CepParamSchema = z
  .string()
  .transform((s) => s.replace(/\D/g, ''))
  .refine((s) => s.length === 8, { message: 'CEP deve ter 8 dígitos' });
