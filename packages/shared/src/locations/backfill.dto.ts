import { z } from 'zod';

/**
 * Migração (backfill) dos contratos BR antigos: os que têm endereço só em
 * texto livre (`streetId` null) e precisam ser vinculados ao cadastro-mestre.
 * Não-destrutivo — a string original fica como fallback até o operador
 * reconciliar.
 */
export const AddressBackfillQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});
export type AddressBackfillQuery = z.infer<typeof AddressBackfillQuerySchema>;

export interface AddressBackfillItem {
  contractId: string;
  contractCode: string | null;
  customerName: string;
  /** Endereço atual em texto livre (a string a reconciliar). */
  installationAddress: string;
  /** CEP extraído da string por heurística (8 dígitos) — pré-preenche o lookup. */
  suggestedCep: string | null;
  /** Número extraído da string por heurística — pré-preenche o campo Número. */
  suggestedNumber: string | null;
}
