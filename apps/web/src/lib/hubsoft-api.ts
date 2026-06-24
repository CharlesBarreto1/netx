/**
 * Client da integração Hubsoft (read-only) — /settings/hubsoft.
 *
 * Espelha o padrão de finance-api (efiApi): chama os endpoints /v1/hubsoft/* e
 * tipa as respostas a partir de @netx/shared. Segredos (client/secret/usuário/
 * senha) são write-only: enviados no saveConfig, nunca retornados.
 */
import type {
  HubsoftConfigResponse,
  HubsoftDiagnosticsResponse,
  HubsoftSyncStats,
  RunHubsoftSyncRequest,
  UpsertHubsoftConfigRequest,
} from '@netx/shared';

import { api } from './api';

export type HubsoftConfigView = HubsoftConfigResponse;
export type HubsoftDiagnostics = HubsoftDiagnosticsResponse;
export type HubsoftSyncResult = HubsoftSyncStats;
export type {
  HubsoftCustomerFilters,
  HubsoftServiceStatus,
  HubsoftSyncEntity,
  HubsoftSyncEntityResult,
  RunHubsoftSyncRequest,
  UpsertHubsoftConfigRequest,
} from '@netx/shared';

export const hubsoftApi = {
  configPath: () => `/v1/hubsoft/config`,
  getConfig() {
    return api.get<HubsoftConfigView>(this.configPath());
  },
  saveConfig(input: UpsertHubsoftConfigRequest) {
    return api.put<HubsoftConfigView>('/v1/hubsoft/config', input);
  },
  // "Testar conexão": OAuth password grant, sem importar nada.
  diagnostics() {
    return api.get<HubsoftDiagnostics>('/v1/hubsoft/config/diagnostics');
  },
  // Dispara import/dry-run. dryRun=true devolve preview sem gravar.
  runSync(input: RunHubsoftSyncRequest = {}) {
    return api.post<HubsoftSyncResult>('/v1/hubsoft/sync', input);
  },
};
