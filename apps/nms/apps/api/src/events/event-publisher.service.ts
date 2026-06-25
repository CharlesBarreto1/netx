import { randomUUID } from 'node:crypto';
import {
  Injectable,
  Logger,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqplib';

import type { Env } from '../config/env.js';
import type { EventEnvelope } from './event-envelope.js';

/**
 * Publisher do bus do ecossistema (canal 3 — lado PRODUTOR). O NMS deixa de só
 * consumir e passa a EMITIR eventos `netx-nms.*` na exchange topic `netx.events`,
 * que o NetX consome (ex.: alimentar o Alarm Center / dashboard).
 *
 * Resiliente e best-effort: se não há `RABBITMQ_URL`, é no-op; se o broker cai,
 * reconecta em background e o publish que falhar apenas loga (nunca derruba a
 * operação de negócio que o disparou). Espelha o envelope do `@netx/core-sdk`.
 */
@Injectable()
export class EventPublisherService implements OnApplicationShutdown {
  private readonly logger = new Logger(EventPublisherService.name);
  private connection?: Awaited<ReturnType<typeof amqp.connect>>;
  private channel?: amqp.Channel;
  private connecting?: Promise<void>;
  private shuttingDown = false;

  constructor(private readonly config: ConfigService<Env, true>) {}

  private get exchange(): string {
    return this.config.get('EVENTBUS_EXCHANGE', { infer: true });
  }

  private async ensureChannel(): Promise<amqp.Channel | undefined> {
    if (this.channel) return this.channel;
    const url = this.config.get('RABBITMQ_URL', { infer: true });
    if (!url || this.shuttingDown) return undefined;
    if (!this.connecting) {
      this.connecting = (async () => {
        try {
          this.connection = await amqp.connect(url);
          this.connection.on('error', () => undefined);
          this.connection.on('close', () => {
            this.connection = undefined;
            this.channel = undefined;
          });
          const ch = await this.connection.createChannel();
          await ch.assertExchange(this.exchange, 'topic', { durable: true });
          this.channel = ch;
        } catch (err) {
          this.logger.warn(
            `publisher: falha ao conectar no RabbitMQ: ${err instanceof Error ? err.message : String(err)}`,
          );
          this.connection = undefined;
          this.channel = undefined;
        } finally {
          this.connecting = undefined;
        }
      })();
    }
    await this.connecting;
    return this.channel;
  }

  /**
   * Publica um evento `netx-nms.<entidade>.<ação>`. Best-effort: nunca lança.
   * `tenantId` vem de EVENTBUS_TENANT_ID (NMS é single-tenant; default `default`).
   */
  async publish<T>(type: string, payload: T, correlationId?: string): Promise<void> {
    const ch = await this.ensureChannel();
    if (!ch) return; // bus desligado ou indisponível — no-op
    const envelope: EventEnvelope<T> = {
      id: randomUUID(),
      type,
      source: 'netx-nms',
      tenantId: this.config.get('EVENTBUS_TENANT_ID', { infer: true }),
      occurredAt: new Date().toISOString(),
      version: 1,
      payload,
      correlationId,
    };
    try {
      ch.publish(this.exchange, type, Buffer.from(JSON.stringify(envelope)), {
        contentType: 'application/json',
        messageId: envelope.id,
        persistent: true,
        headers: { tenantId: envelope.tenantId, eventType: type, eventVersion: 1 },
      });
    } catch (err) {
      this.logger.warn(
        `publisher: falha ao publicar ${type}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async onApplicationShutdown(): Promise<void> {
    this.shuttingDown = true;
    try {
      await this.channel?.close();
      await this.connection?.close();
    } catch {
      // best-effort
    }
  }
}
