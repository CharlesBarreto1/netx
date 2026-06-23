/**
 * Envelope de evento canônico do bus do ecossistema (invariante 2c).
 *
 * Inspirado no CloudEvents: metadados estáveis no envelope, payload específico
 * por tipo. É o CONTRATO que módulos publicam/consomem — o acoplamento entre
 * módulos vive AQUI, nunca em chamada direta entre eles.
 *
 * Ver docs/ecosystem/ECOSYSTEM-MODULAR-PLAN.md (Fase 3).
 */

import { randomUUID } from 'node:crypto';

import type { ModuleCode } from '@netx/shared';

/** Tipo do evento: convenção `<moduleCode>.<entidade>.<ação>`, ex.: `netx-erp.contract.created`. */
export type EventType = string;

export interface EventEnvelope<T = unknown> {
  /** Id único do evento — chave de idempotência no consumidor. */
  id: string;
  /** Tipo do evento (`<módulo>.<entidade>.<ação>`). */
  type: EventType;
  /** Módulo de origem (catálogo de módulos). */
  source: ModuleCode;
  /** Tenant dono do dado (multi-tenant estrito — nunca cruza fronteira de tenant). */
  tenantId: string;
  /** Quando o fato ocorreu (ISO 8601). */
  occurredAt: string;
  /** Versão do schema do `payload` deste `type` (começa em 1). */
  version: number;
  /** Dados específicos do evento. */
  payload: T;
  /** Correlação opcional para rastrear uma cadeia causal entre eventos. */
  correlationId?: string;
}

export interface MakeEnvelopeInput<T> {
  type: EventType;
  source: ModuleCode;
  tenantId: string;
  payload: T;
  /** Default 1. */
  version?: number;
  correlationId?: string;
  /** Override de id (default: `randomUUID()`). Útil em testes. */
  id?: string;
  /** Override do instante (default: agora, ISO). Útil em testes. */
  occurredAt?: string;
}

/** Monta um envelope preenchendo id/timestamp/versão com defaults seguros. */
export function makeEnvelope<T>(input: MakeEnvelopeInput<T>): EventEnvelope<T> {
  return {
    id: input.id ?? randomUUID(),
    type: input.type,
    source: input.source,
    tenantId: input.tenantId,
    occurredAt: input.occurredAt ?? new Date().toISOString(),
    version: input.version ?? 1,
    payload: input.payload,
    ...(input.correlationId ? { correlationId: input.correlationId } : {}),
  };
}

/**
 * Porta de publicação (arquitetura hexagonal). O Core define o CONTRATO; o
 * transporte real (RabbitMQ) é um ADAPTADOR (Fase 3) plugado por DI. Manter a
 * porta aqui permite um Noop em runtime enquanto o bus está desligado — honra o
 * invariante "mudança do ecossistema entra desligada".
 */
export interface EventPublisher {
  publish<T>(envelope: EventEnvelope<T>): Promise<void>;
}

/** Token de DI (string) para o `EventPublisher`. */
export const EVENT_PUBLISHER = 'EVENT_PUBLISHER';

/**
 * Publisher que descarta o evento (bus desligado). É o default seguro: enquanto
 * nenhum adaptador AMQP estiver configurado, publicar é um no-op silencioso e
 * nenhuma costura de negócio muda de comportamento.
 */
export class NoopEventPublisher implements EventPublisher {
  async publish(): Promise<void> {
    /* no-op: bus desligado */
  }
}
