/**
 * Envelope de evento do bus do ecossistema (canal 3). É um ESPELHO mínimo do
 * `EventEnvelope` de `@netx/core-sdk` — só os campos que o NMS consome. Não
 * importamos o tipo do Core pra manter o NMS desacoplado do workspace npm
 * (ele é um sub-build pnpm isolado). O contrato real (nome/forma) vive no Core;
 * aqui só lemos. Ver docs/ecosystem/INTEGRATION-RUNBOOK.md §A.3.
 */
export interface EventEnvelope<T = unknown> {
  /** Id único do evento — chave de idempotência. */
  id: string;
  /** Tipo `<módulo>.<entidade>.<ação>` (= routing key na exchange topic). */
  type: string;
  /** Módulo de origem (catálogo de módulos do ecossistema). */
  source: string;
  /** Tenant dono do dado. */
  tenantId: string;
  /** Quando o fato ocorreu (ISO 8601). */
  occurredAt: string;
  /** Versão do schema do payload deste type. */
  version: number;
  /** Dados específicos do evento. */
  payload: T;
  /** Correlação opcional (cadeia causal). */
  correlationId?: string;
}
