import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  EVENT_PUBLISHER,
  makeEnvelope,
  type EventPublisher,
  type ModuleCode,
} from '@netx/core-sdk';

/**
 * Wrapper injetável e RESILIENTE em torno da porta `EventPublisher` (Fase 3).
 * Monta o envelope e isola a publicação: se o bus estiver desligado (Noop) ou a
 * publicação falhar, NUNCA propaga — apenas loga. É fire-and-forget, para que
 * nenhuma costura de negócio dependa do bus. Qualquer módulo injeta este service
 * e chama `emit()`, sem repetir o try/catch.
 */
@Injectable()
export class EventBusPublisher {
  private readonly logger = new Logger(EventBusPublisher.name);

  constructor(@Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisher) {}

  async emit<T>(
    type: string,
    tenantId: string,
    payload: T,
    source: ModuleCode = 'netx-erp',
  ): Promise<void> {
    try {
      await this.publisher.publish(makeEnvelope<T>({ type, source, tenantId, payload }));
    } catch (err) {
      this.logger.warn(
        `[eventbus] falha ao publicar ${type}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
