import { z } from 'zod';

/**
 * Deploy — bem patrimonial instalado na rede PRÓPRIA (não é do cliente).
 *
 * Irmão do comodato, com destino diferente:
 *   - comodato → cliente  (status ALLOCATED, contractId)
 *   - deploy   → operação (status IN_USE, popId [+ networkEquipmentId])
 *
 * Fluxo:
 *   1. Operador cadastra o equipamento em Técnico > Planta de rede escolhendo
 *      um bem disponível do estoque — o bem sai do depósito e vira IN_USE no
 *      mesmo passo (sem recadastro de serial/marca/modelo).
 *   2. Quando o equipamento é substituído ou desativado, "recolher" devolve o
 *      bem ao estoque num local escolhido.
 */

export const DeployAssetRequestSchema = z.object({
  serialItemId: z.string().uuid(),
  popId: z.string().uuid(),
  /** Equipamento da planta que este bem É (1:1). Opcional: rack, nobreak e
   *  gerador ficam no POP sem virar equipamento gerenciável. */
  networkEquipmentId: z.string().uuid().nullish(),
  notes: z.string().max(2000).nullish(),
});
export type DeployAssetRequest = z.infer<typeof DeployAssetRequestSchema>;

export const ReturnDeployedAssetRequestSchema = z.object({
  serialItemId: z.string().uuid(),
  toLocationId: z.string().uuid(),
  notes: z.string().max(2000).nullish(),
});
export type ReturnDeployedAssetRequest = z.infer<
  typeof ReturnDeployedAssetRequestSchema
>;

/** Bem instalado num POP — inventário de campo. */
export interface DeployedAssetResponse {
  id: string;
  serial: string;
  assetTag: string | null;
  status: string;
  deployedAt: string | null;
  product: {
    id: string;
    sku: string;
    name: string;
    brand: string | null;
    model: string | null;
  };
  networkEquipment: {
    id: string;
    name: string;
    type: string;
    ipAddress: string;
  } | null;
}

/** Bem livre pra instalar — alimenta o seletor do formulário de equipamento. */
export interface AvailableAssetResponse {
  id: string;
  serial: string;
  assetTag: string | null;
  product: {
    id: string;
    sku: string;
    name: string;
    brand: string | null;
    model: string | null;
  };
  location: { id: string; name: string } | null;
}
