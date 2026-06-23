import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  EVENT_PUBLISHER,
  makeEnvelope,
  type EventPublisher,
  type ModuleCode,
} from '@netx/core-sdk';

/**
 * Teto de espera pela publicação. Evita pendurar a costura de negócio se o broker
 * cair: o amqp-connection-manager bufferiza a mensagem e a entrega na reconexão,
 * mas a Promise de confirmação fica pendente — então seguimos após o timeout.
 */
const PUBLISH_TIMEOUT_MS = 2000;

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
    // Publica em background com tratamento de erro próprio (nunca propaga).
    const published = this.publisher
      .publish(makeEnvelope<T>({ type, source, tenantId, payload }))
      .catch((err) => {
        this.logger.warn(
          `[eventbus] falha ao publicar ${type}: ${err instanceof Error ? err.message : String(err)}`,
        );
      });

    // Corre contra um teto: com o broker fora do ar a confirmação não chega, mas
    // a costura de negócio não pode pendurar — a mensagem fica bufferizada.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, PUBLISH_TIMEOUT_MS);
    });
    await Promise.race([published, timeout]);
    if (timer) clearTimeout(timer);
  }
}
