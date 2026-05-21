/**
 * DTOs pra gerenciamento de Wi-Fi pós-instalação.
 *
 * Quando o cliente solicita mudar SSID/senha, atendimento usa essa rota.
 * NetX persiste no Contract (encrypted) e enfileira Tr069Task SET_PARAMS
 * pro ACS aplicar no próximo Inform (≤60s).
 *
 * Senha NUNCA retorna em response — só boolean `hasWifiPassword` + audit log.
 *
 * @provenance Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=
 */
import { z } from 'zod';

import { SsidSchema, WifiPasswordSchema } from '../provisioning/types';

export const UpdateContractWifiRequestSchema = z
  .object({
    ssid: SsidSchema,
    wifiPassword: WifiPasswordSchema,
    /**
     * Reiniciar a ONT depois de aplicar params. Alguns CPEs Huawei
     * EG8145 aplicam SSID sem reboot (módulo Wi-Fi reinicia sozinho),
     * outros exigem. Default false — admin marca se cliente reclamar
     * de Wi-Fi não atualizar.
     */
    reboot: z.coerce.boolean().default(false),
  })
  .strict();
export type UpdateContractWifiRequest = z.infer<typeof UpdateContractWifiRequestSchema>;

export interface ContractWifiStatus {
  ssid: string | null;
  hasWifiPassword: boolean;
  /** Existe ONT + Tr069Device vinculado pra realmente aplicar? */
  hasTr069Device: boolean;
  /** Última task TR-069 ligada a esse contrato (qualquer ação). */
  lastTask: {
    id: string;
    action:
      | 'SET_PARAMS'
      | 'GET_PARAMS'
      | 'REBOOT'
      | 'FACTORY_RESET'
      | 'DOWNLOAD'
      | 'ADD_OBJECT'
      | 'DELETE_OBJECT';
    status: 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED' | 'CANCELLED';
    createdAt: string;
    completedAt: string | null;
    error: string | null;
  } | null;
  /** Último Inform recebido (UI mostra "online há Xmin"). */
  lastInformAt: string | null;
}

export interface UpdateContractWifiResponse {
  /** Task SET_PARAMS criada. */
  setParamsTaskId: string;
  /** Task REBOOT criada (se reboot=true). */
  rebootTaskId: string | null;
  /** ETA de aplicação em segundos (= PeriodicInformInterval atual ≈ 60s). */
  etaSeconds: number;
}
