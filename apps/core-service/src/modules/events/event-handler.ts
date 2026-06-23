import type { EventEnvelope } from '@netx/core-sdk';

/** Token de DI (multi) para registrar handlers consumidos pelo EventConsumer. */
export const EVENT_HANDLERS = 'EVENT_HANDLERS';

/**
 * Handler de evento do bus (Fase 3). Um módulo registra um provider
 * `{ provide: EVENT_HANDLERS, useClass: MeuHandler, multi: true }` e o
 * EventConsumer despacha para ele os eventos cujo `pattern` casa.
 *
 * Convenção de `pattern`:
 *   - `'netx-erp.contract.created'` — tipo exato;
 *   - `'netx-erp.*'`                — prefixo (tudo do ERP);
 *   - `'#'`                         — todos os eventos.
 *
 * `handle()` deve ser IDEMPOTENTE — o consumidor já deduplica por `envelope.id`,
 * mas em cenário de redistribuição (reconexão/redelivery) pode repetir.
 */
export interface EventHandler {
  readonly pattern: string;
  handle(envelope: EventEnvelope): Promise<void> | void;
}

/** Casa um tipo de evento contra o `pattern` de um handler. */
export function eventMatches(pattern: string, type: string): boolean {
  if (pattern === '#') return true;
  if (pattern.endsWith('.*')) return type.startsWith(pattern.slice(0, -1));
  return pattern === type;
}
