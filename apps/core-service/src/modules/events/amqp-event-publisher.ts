import { Logger } from '@nestjs/common';
import amqp, { type AmqpConnectionManager, type ChannelWrapper } from 'amqp-connection-manager';
import type { ConfirmChannel } from 'amqplib';

import type { EventEnvelope, EventPublisher } from '@netx/core-sdk';

/** Exchange topic única do bus do ecossistema; routing key = `envelope.type`. */
export const EVENTS_EXCHANGE = 'netx.events';

/**
 * Declara a exchange do bus (topic, durável). FONTE ÚNICA do contrato da
 * exchange — publisher e consumer chamam isto no setup do canal, pra nunca
 * divergirem no nome/tipo/durabilidade.
 */
export async function assertEventsExchange(
  ch: ConfirmChannel,
  exchange: string = EVENTS_EXCHANGE,
): Promise<void> {
  await ch.assertExchange(exchange, 'topic', { durable: true });
}

/**
 * Adaptador AMQP da porta `EventPublisher` (Fase 3). Usa amqp-connection-manager
 * (reconexão automática e em background): se o broker cair, publicar não derruba
 * o serviço — a conexão se restabelece sozinha. Só é instanciado quando o bus
 * está LIGADO (ver EventBusModule); desligado, usa-se o NoopEventPublisher.
 */
export class AmqpEventPublisher implements EventPublisher {
  private readonly logger = new Logger(AmqpEventPublisher.name);
  private readonly connection: AmqpConnectionManager;
  private readonly channel: ChannelWrapper;

  constructor(
    url: string,
    private readonly exchange: string = EVENTS_EXCHANGE,
  ) {
    this.connection = amqp.connect([url]);
    this.connection.on('connect', () =>
      this.logger.log(`conectado ao RabbitMQ (exchange topic "${this.exchange}")`),
    );
    this.connection.on('disconnect', ({ err }) =>
      this.logger.warn(`desconectado do RabbitMQ: ${err?.message ?? 'sem detalhe'} — reconectando`),
    );
    this.channel = this.connection.createChannel({
      json: false,
      setup: (ch: ConfirmChannel) => assertEventsExchange(ch, this.exchange),
    });
  }

  async publish<T>(envelope: EventEnvelope<T>): Promise<void> {
    const content = Buffer.from(JSON.stringify(envelope));
    await this.channel.publish(this.exchange, envelope.type, content, {
      contentType: 'application/json',
      messageId: envelope.id,
      persistent: true,
      headers: {
        tenantId: envelope.tenantId,
        eventType: envelope.type,
        eventVersion: envelope.version,
      },
    });
  }

  /** Fecha canal e conexão (graceful shutdown). */
  async close(): Promise<void> {
    await this.channel.close();
    await this.connection.close();
  }
}
