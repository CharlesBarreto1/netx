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
  WifiPasswordSchema,
  type ProvisioningEventAction,
  type ProvisioningEventStatus,
} from './types';

export const InstallCustomerRequestSchema = z
  .object({
    /** OLT onde a ONT será autorizada. */
    oltId: z.string().uuid(),
    /** Serial GPON da ONT (etiqueta na carcaça). */
    snGpon: SnGponSchema,
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

    /** Notas livres do técnico (opcional). */
    notes: z.string().max(2000).nullish(),
  })
  .strict();
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
