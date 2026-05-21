import { z } from 'zod';

/**
 * ServiceOrderReason — config do tenant. Cada tenant cadastra seus próprios
 * motivos pra O.S (ex.: "Visita técnica", "Troca de equipamento", "Mudança
 * de endereço"). Exibido como select no form de O.S.
 *
 * Não deletamos linha — vira `isActive=false` pra preservar referências
 * históricas em O.S antigas.
 */

export const CreateServiceOrderReasonRequestSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).nullish(),
  isActive: z.boolean().default(true),
  /**
   * Marca este motivo como "instalação". OS desse motivo só pode ser fechada
   * (COMPLETED) com SerialItem ALLOCATED ao contrato — trava de segurança que
   * impede técnico finalizar instalação sem registrar equipamento entregue.
   */
  isInstallation: z.coerce.boolean().default(false),
  /** Ordem de exibição em selects (asc). 0 = primeiro. */
  order: z.number().int().min(0).max(9999).default(0),
});
export type CreateServiceOrderReasonRequest = z.infer<
  typeof CreateServiceOrderReasonRequestSchema
>;

export const UpdateServiceOrderReasonRequestSchema =
  CreateServiceOrderReasonRequestSchema.partial();
export type UpdateServiceOrderReasonRequest = z.infer<
  typeof UpdateServiceOrderReasonRequestSchema
>;

export const ListServiceOrderReasonsQuerySchema = z.object({
  /** Quando true, traz inclusive os inativos. Default: só ativos. */
  includeInactive: z.coerce.boolean().default(false),
});
export type ListServiceOrderReasonsQuery = z.infer<
  typeof ListServiceOrderReasonsQuerySchema
>;

export interface ServiceOrderReasonResponse {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  isActive: boolean;
  isInstallation: boolean;
  order: number;
  createdAt: string;
  updatedAt: string;
}
