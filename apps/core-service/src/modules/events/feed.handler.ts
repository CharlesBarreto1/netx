import { Injectable, Logger } from '@nestjs/common';

import type { EventEnvelope } from '@netx/core-sdk';

import type { EventHandler } from './event-handler';
import { FeedStream } from './feed-stream.service';

/**
 * FeedHandler — ponte bus AMQP → SSE do feed (NEXUS/Field). Assina TUDO (`#`) e
 * re-emite no FeedStream por tenant. Só flui quando EVENTBUS_CONSUME=true; com o
 * bus desligado, produtores in-process ainda podem publicar direto no FeedStream.
 * Reaproveita o EventConsumer (mesmo padrão do NmsEventsHandler).
 */
@Injectable()
export class FeedHandler implements EventHandler {
  readonly pattern = '#';
  private readonly logger = new Logger(FeedHandler.name);

  constructor(private readonly feed: FeedStream) {}

  async handle(env: EventEnvelope): Promise<void> {
    this.feed.publish(env.tenantId, env.type, {
      type: env.type,
      source: env.source,
      at: env.occurredAt,
      payload: env.payload,
    });
  }
}
