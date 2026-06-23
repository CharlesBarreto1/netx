import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import amqp, { type AmqpConnectionManager, type ChannelWrapper } from 'amqp-connection-manager';
import type { ConfirmChannel, ConsumeMessage } from 'amqplib';

import { loadConfig } from '@netx/config';
import type { EventEnvelope } from '@netx/core-sdk';

import { EVENTS_EXCHANGE } from './amqp-event-publisher';
import { EVENT_HANDLERS, eventMatches, type EventHandler } from './event-handler';

/** Fila durável que recebe tudo da exchange (espelho de auditoria/round-trip). */
const INBOX_QUEUE = 'netx.events.inbox';
/** Teto do cache de idempotência em memória (evita crescer sem limite). */
const DEDUP_CAP = 5000;

/**
 * Consumidor do bus (Fase 3). DESLIGADO por default — só liga com
 * `EVENTBUS_CONSUME=true|1`. Liga uma fila durável à exchange topic `netx.events`
 * (routing key `#` = tudo), processa cada evento de forma IDEMPOTENTE (dedup por
 * `envelope.id`) e dá ack.
 *
 * Ainda não há consumidor de NEGÓCIO: por ora só registra a recepção (prova o
 * round-trip publish→broker→consume). Handlers reais (ex.: ao receber
 * `netx-erp.contract.created`, o NMS provisiona) entram em `dispatch()`.
 */
@Injectable()
export class EventConsumer implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(EventConsumer.name);
  private connection?: AmqpConnectionManager;
  private channel?: ChannelWrapper;
  private readonly seen = new Set<string>();
  private readonly seenOrder: string[] = [];

  constructor(
    @Optional() @Inject(EVENT_HANDLERS) private readonly handlers: EventHandler[] = [],
  ) {}

  private static enabled(): boolean {
    const v = process.env.EVENTBUS_CONSUME;
    return v === 'true' || v === '1';
  }

  onApplicationBootstrap(): void {
    if (!EventConsumer.enabled()) {
      this.logger.log('consumo DESLIGADO (EVENTBUS_CONSUME != true)');
      return;
    }
    const { rabbitmq } = loadConfig();
    this.connection = amqp.connect([rabbitmq.url]);
    this.channel = this.connection.createChannel({
      json: false,
      setup: async (ch: ConfirmChannel) => {
        await ch.assertExchange(EVENTS_EXCHANGE, 'topic', { durable: true });
        await ch.assertQueue(INBOX_QUEUE, { durable: true });
        await ch.bindQueue(INBOX_QUEUE, EVENTS_EXCHANGE, '#');
        await ch.prefetch(20);
        await ch.consume(INBOX_QUEUE, (msg) => this.onMessage(ch, msg));
      },
    });
    this.logger.log(`consumo LIGADO — fila "${INBOX_QUEUE}" ligada a "${EVENTS_EXCHANGE}" (#)`);
  }

  private async onMessage(ch: ConfirmChannel, msg: ConsumeMessage | null): Promise<void> {
    if (!msg) return;
    let env: EventEnvelope;
    try {
      env = JSON.parse(msg.content.toString('utf8')) as EventEnvelope;
    } catch (err) {
      // Mensagem ilegível (poison): ack sem requeue pra não travar a fila.
      this.logger.warn(
        `descartando mensagem ilegível: ${err instanceof Error ? err.message : String(err)}`,
      );
      ch.ack(msg);
      return;
    }

    if (env.id && this.seen.has(env.id)) {
      this.logger.debug(`evento ${env.type} id=${env.id} já processado — ignorando (idempotência)`);
      ch.ack(msg);
      return;
    }
    this.remember(env.id);
    await this.dispatch(env);
    ch.ack(msg);
  }

  /** Despacha o evento aos handlers registrados (EVENT_HANDLERS) cujo pattern casa. */
  private async dispatch(env: EventEnvelope): Promise<void> {
    this.logger.log(
      `consumido ${env.type} id=${env.id} tenant=${env.tenantId} source=${env.source}`,
    );
    for (const h of this.handlers) {
      if (!eventMatches(h.pattern, env.type)) continue;
      try {
        await h.handle(env);
      } catch (err) {
        // Handler falhou: loga e segue (ack mesmo assim — evita poison loop).
        // Handler que precise de retry deve cuidar da própria reentrega.
        this.logger.warn(
          `handler ${h.constructor.name} falhou em ${env.type} id=${env.id}: ` +
            `${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  private remember(id: string): void {
    if (!id) return;
    this.seen.add(id);
    this.seenOrder.push(id);
    if (this.seenOrder.length > DEDUP_CAP) {
      const old = this.seenOrder.shift();
      if (old) this.seen.delete(old);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.channel?.close();
    await this.connection?.close();
  }
}
