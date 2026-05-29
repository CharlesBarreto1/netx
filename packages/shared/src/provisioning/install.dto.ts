/**
 * DTOs pro fluxo principal: ativação de cliente em campo via
 * /provisioning/install/:contractId.
 *
 * Input vem do formulário mobile do técnico. Output retorna a timeline de
 * eventos pra UI mostrar progresso em tempo real (Authorize → Wait Inform →
 * Apply Wi-Fi → Reboot → Online).
 *
 * @provenance Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=
 */
import { z } from 'zod';
import {
  MacAddressSchema,
  ProvisioningEventActionSchema,
  ProvisioningEventStatusSchema,
  SnGponSchema,
  SsidSchema,
  WifiBandModeSchema,
  WifiPasswordSchema,
  type ProvisioningEventAction,
  type ProvisioningEventStatus,
} from './types';

export const InstallCustomerRequestSchema = z
  .object({
    /** OLT onde a ONT será autorizada. */
    oltId: z.string().uuid(),
    /**
     * SerialItem do estoque (PATRIMONIAL, status=IN_STOCK) que vai virar
     * a ONT do cliente. Obrigatório por padrão — trava de segurança que
     * impede "ONT fantasma" sem rastreio no estoque.
     *
     * Pra desligar (debug/migração), passar `allowStockBypass=true` E
     * fornecer `snGpon` direto.
     */
    serialItemId: z.string().uuid().nullish(),
    /**
     * Bypass de validação de estoque. Usado em migração inicial / debug
     * quando ainda não há produtos cadastrados em estoque. Em produção
     * normal deve ficar false.
     */
    allowStockBypass: z.coerce.boolean().default(false),
    /**
     * Serial GPON da ONT (etiqueta na carcaça). Quando `serialItemId` é
     * fornecido, ignoramos esse campo (usamos SerialItem.serial). Quando
     * `allowStockBypass=true`, este campo é OBRIGATÓRIO.
     */
    snGpon: SnGponSchema.nullish(),
    /** Posição PON (opcional pra ORCHESTRATOR — provider decide). */
    ponFrame: z.coerce.number().int().min(0).nullish(),
    ponSlot: z.coerce.number().int().min(0).nullish(),
    /** MAC da WAN da ONT (opcional — pode chegar via TR-069 Inform depois). */
    macAddress: MacAddressSchema.nullish(),
    /** Serial físico opcional (inventário). */
    serialPhysical: z.string().max(64).nullish(),

    /** Wi-Fi pra TR-069 aplicar via SetParameterValues (Fase 3). */
    ssid: SsidSchema,
    wifiPassword: WifiPasswordSchema,
    /**
     * Modo de Wi-Fi — depende do modelo da ONT:
     *   BAND_STEERING (EG8145X6/X10) — SSID único nas 2 bandas.
     *   DUAL_BAND (EG8145V5) — 2.4G nome normal, 5G "5G-"+nome.
     * Default BAND_STEERING (modelos mais novos).
     */
    wifiBandMode: WifiBandModeSchema.default('BAND_STEERING'),

    /**
     * VLAN da WAN PPPoE (802.1Q). Default 1010 — o preset da OLT já cria a
     * WAN2 com essa VLAN; o NetX reaplica via TR-069 pra garantir. Só usada
     * em contratos PPPoE.
     */
    pppoeVlan: z.coerce.number().int().min(1).max(4094).default(1010),

    /** Notas livres do técnico (opcional). */
    notes: z.string().max(2000).nullish(),

    /**
     * Ufinet (rede neutra PY): caixa (CTO) e porta REAIS onde o técnico
     * conectou o drop em campo. Sobrescrevem a CTO *sugerida* pela Ufinet na
     * confirmação do serviço (enviadas como CTO_PORT). Opcionais — só usadas em
     * OLT UFINET/ORCHESTRATOR.
     */
    ufinetCto: z.string().max(64).nullish(),
    ufinetPort: z.string().max(32).nullish(),
  })
  .strict()
  .superRefine((data, ctx) => {
    // serialItemId XOR (allowStockBypass + snGpon)
    if (!data.serialItemId && !data.allowStockBypass) {
      ctx.addIssue({
        code: 'custom',
        path: ['serialItemId'],
        message:
          'Selecione o equipamento do estoque (SerialItem). Pra ignorar essa ' +
          'validação em modo debug, marque allowStockBypass=true e preencha snGpon.',
      });
    }
    if (data.allowStockBypass && !data.snGpon) {
      ctx.addIssue({
        code: 'custom',
        path: ['snGpon'],
        message: 'allowStockBypass=true exige snGpon preenchido manualmente.',
      });
    }
  });
export type InstallCustomerRequest = z.infer<typeof InstallCustomerRequestSchema>;

export interface InstallTimelineEvent {
  action: ProvisioningEventAction;
  status: ProvisioningEventStatus;
  message: string;
  durationMs: number | null;
  at: string;
  error?: string | null;
}

export interface InstallCustomerResponse {
  contractId: string;
  ontId: string;
  status: 'OK' | 'PARTIAL' | 'FAILED';
  /** Timeline cronológica dos passos executados pelo orquestrador. */
  timeline: InstallTimelineEvent[];
  /** Para o front fazer poll depois (ex.: aguardar Inform TR-069). */
  pollUrl?: string;
}

/**
 * GET /provisioning/pending — contratos PENDING_INSTALL aguardando técnico.
 */
export const ListPendingInstallsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(120).optional(),
});
export type ListPendingInstallsQuery = z.infer<typeof ListPendingInstallsQuerySchema>;

export interface PendingInstallItem {
  contractId: string;
  contractCode: string | null;
  customerId: string;
  customerName: string;
  installationAddress: string;
  bandwidthMbps: number;
  monthlyValue: string;
  createdAt: string;
}
