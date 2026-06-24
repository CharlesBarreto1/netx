import { z } from 'zod';

// =============================================================================
// Hubsoft — integração de LEITURA (read-only) para migração/operação conjunta.
//
// O NetX consome a API oficial do Hubsoft (https://docs.hubsoft.com.br) durante
// a transição de um provedor que está saindo do Hubsoft. Puxamos clientes,
// contratos (serviços) e financeiro (faturas) e espelhamos nos modelos do NetX.
//
// Auth do Hubsoft = OAuth2 *password grant*: host + client_id + client_secret +
// username + password (todos por provedor). São WRITE-ONLY: enviados aqui,
// nunca devolvidos. Campo de segredo ausente/'' = mantém o valor atual.
// =============================================================================

export const HubsoftSyncEntitySchema = z.enum([
  'customers', // cliente + servicos[] -> Customer + Contract (+ Plan)
  'financeiro', // cliente/financeiro -> ContractInvoice
]);
export type HubsoftSyncEntity = z.infer<typeof HubsoftSyncEntitySchema>;

// -----------------------------------------------------------------------------
// FILTROS de busca de clientes
//
// IMPORTANTE: a API do Hubsoft NÃO filtra cidade/status/grupo no servidor — só
// aceita `busca` (nome/cpf/codigo/...) + `cancelado=sim/nao`. Por isso estes
// filtros são aplicados CLIENT-SIDE no import (após buscar), com um pushdown do
// `cancelado` quando o filtro de status permite (otimização). Os três são
// combináveis (AND) e atuam por SERVIÇO do cliente: o cliente entra se tiver ao
// menos um serviço que satisfaça status+grupo, e só os serviços que casam viram
// contratos. `cidades` casa no endereço (cliente ou instalação do serviço).
// -----------------------------------------------------------------------------
export const HubsoftServiceStatusSchema = z.enum(['ativo', 'bloqueado', 'cancelado']);
export type HubsoftServiceStatus = z.infer<typeof HubsoftServiceStatusSchema>;

export const HubsoftCustomerFiltersSchema = z
  .object({
    // Nomes de cidade (casa em qualquer endereço; sem acento/maiúsculas).
    cidades: z.array(z.string().min(1)).min(1).optional(),
    // Status do SERVIÇO no Hubsoft (status_prefixo): ativo|bloqueado|cancelado.
    status: z.array(HubsoftServiceStatusSchema).min(1).optional(),
    // Grupo/plano do serviço — casa contra id_servico, nome/numero do plano e
    // código dos pacotes do serviço (flexível; valide com dry-run).
    grupos: z.array(z.string().min(1)).min(1).optional(),
  })
  .strict();
export type HubsoftCustomerFilters = z.infer<typeof HubsoftCustomerFiltersSchema>;

// -----------------------------------------------------------------------------
// CONFIG (por tenant) — escrita
// -----------------------------------------------------------------------------
export const UpsertHubsoftConfigRequestSchema = z
  .object({
    enabled: z.boolean().optional(),

    // Endereço do servidor do provedor (ex.: https://api.provedor.hubsoft.com.br).
    // Não-secreto.
    host: z.string().url().max(255).optional(),

    // Credenciais OAuth2 password grant (write-only).
    clientId: z.string().min(1).max(255).optional(),
    clientSecret: z.string().min(1).max(255).optional(),
    username: z.string().min(1).max(255).optional(),
    password: z.string().min(1).max(255).optional(),

    // Sync contínuo automático (cron). Read-only — nunca escreve no Hubsoft.
    autoSync: z.boolean().optional(),
    // Quais entidades o sync automático puxa.
    syncCustomers: z.boolean().optional(),
    syncFinanceiro: z.boolean().optional(),
  })
  .strict();
export type UpsertHubsoftConfigRequest = z.infer<
  typeof UpsertHubsoftConfigRequestSchema
>;

// -----------------------------------------------------------------------------
// CONFIG — resposta (sem segredos)
// -----------------------------------------------------------------------------
export interface HubsoftConfigResponse {
  tenantId: string;
  enabled: boolean;
  host: string | null;

  // Presença das credenciais (nunca o valor em si).
  hasCredentials: boolean;

  autoSync: boolean;
  syncCustomers: boolean;
  syncFinanceiro: boolean;

  // Telemetria do último sync.
  lastSyncAt: string | null;
  lastSyncStatus: string | null; // OK | PARTIAL | ERROR
  lastSyncError: string | null;
  lastSyncStats: HubsoftSyncStats | null;

  createdAt: string | null;
  updatedAt: string | null;
}

// -----------------------------------------------------------------------------
// SYNC — disparo manual / dry-run
// -----------------------------------------------------------------------------
export const RunHubsoftSyncRequestSchema = z
  .object({
    // Quais entidades importar nesta execução (default: as habilitadas na config).
    entities: z.array(HubsoftSyncEntitySchema).min(1).optional(),
    // dryRun=true: busca + mapeia + devolve preview, NÃO grava nada.
    dryRun: z.boolean().optional(),
    // Limite de registros (proteção; principalmente útil em dry-run).
    limit: z.coerce.number().int().min(1).max(5000).optional(),
    // Filtros aplicados à busca de clientes (cidade/status/grupo de serviço).
    filters: HubsoftCustomerFiltersSchema.optional(),
  })
  .strict();
export type RunHubsoftSyncRequest = z.infer<typeof RunHubsoftSyncRequestSchema>;

export interface HubsoftSyncEntityResult {
  entity: HubsoftSyncEntity;
  fetched: number; // quantos vieram do Hubsoft
  filteredOut?: number; // descartados pelos filtros (cidade/status/grupo)
  created: number; // novos no NetX
  updated: number; // já existiam, atualizados
  skipped: number; // ignorados (ex.: sem chave)
  failed: number;
  errors: Array<{ ref: string; message: string }>;
  // Em dry-run, amostra do que SERIA gravado (sem persistir).
  preview?: unknown[];
}

export interface HubsoftSyncStats {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  dryRun: boolean;
  entities: HubsoftSyncEntityResult[];
}

// -----------------------------------------------------------------------------
// DIAGNÓSTICO — "Testar conexão" (OAuth password grant, sem importar nada)
// -----------------------------------------------------------------------------
export interface HubsoftDiagnosticsResponse {
  host: string | null;
  ok: boolean;
  status: number;
  hint: string;
  // Amostra mínima do retorno (ex.: contagem de clientes), sem PII pesada.
  sample: unknown;
}
