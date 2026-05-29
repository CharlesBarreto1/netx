import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Contexto de trace propagado do UfinetOrdersService (que sabe o tenant +
 * externalId) até o UfinetClientService (que faz o HTTP), sem precisar passar
 * o contexto por todas as assinaturas. O cliente lê o store no `request()` e
 * persiste cada chamada em `ufinet_request_logs` (evidência pra chamados).
 *
 * Seguro com a concorrência atual (poller processa serviços em sequência) e
 * à prova de futuro (cada cadeia async tem seu próprio store).
 */
export interface UfinetTraceCtx {
  tenantId: string;
  externalId: string;
}

export const ufinetTrace = new AsyncLocalStorage<UfinetTraceCtx>();
