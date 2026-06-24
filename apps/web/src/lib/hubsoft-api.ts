/**
 * Client da integração Hubsoft (read-only) — /settings/hubsoft.
 *
 * Espelha o padrão de finance-api (efiApi): chama os endpoints /v1/hubsoft/* e
 * tipa as respostas a partir de @netx/shared. Segredos (client/secret/usuário/
 * senha) são write-only: enviados no saveConfig, nunca retornados.
 */
import type {
  BrowseHubsoftCustomersRequest,
  BrowseHubsoftCustomersResponse,
  HubsoftConfigResponse,
  HubsoftDiagnosticsResponse,
  HubsoftSyncStats,
  ImportHubsoftCustomersRequest,
  RunHubsoftSyncRequest,
  UpsertHubsoftConfigRequest,
} from '@netx/shared';

import { api } from './api';

export type HubsoftConfigView = HubsoftConfigResponse;
export type HubsoftDiagnostics = HubsoftDiagnosticsResponse;
export type HubsoftSyncResult = HubsoftSyncStats;
export type HubsoftBrowseResult = BrowseHubsoftCustomersResponse;
export type {
  BrowseHubsoftCustomersRequest,
  BrowseHubsoftCustomersResponse,
  HubsoftCustomerFilters,
  HubsoftCustomerListItem,
  HubsoftServiceStatus,
  HubsoftSyncEntity,
  HubsoftSyncEntityResult,
  ImportHubsoftCustomersRequest,
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
  // Lista clientes do Hubsoft (paginado/filtrado) p/ escolher quem importar.
  browse(input: BrowseHubsoftCustomersRequest) {
    return api.post<HubsoftBrowseResult>('/v1/hubsoft/customers/search', input);
  },
  // Importa a seleção (codigos).
  importSelected(input: ImportHubsoftCustomersRequest) {
    return api.post<HubsoftSyncResult>('/v1/hubsoft/customers/import', input);
  },
  // Re-sincroniza agora só os já importados (mesma rotina do cron 4x/dia).
  syncImported() {
    return api.post<HubsoftSyncResult>('/v1/hubsoft/sync/imported');
  },
  // Sync genérico/dry-run (uso avançado).
  runSync(input: RunHubsoftSyncRequest = {}) {
    return api.post<HubsoftSyncResult>('/v1/hubsoft/sync', input);
  },
};
