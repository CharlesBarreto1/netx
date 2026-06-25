import { Injectable, Logger } from '@nestjs/common';

import type { EventEnvelope } from '@netx/core-sdk';

import type { EventHandler } from './event-handler';

/**
 * Handler do NetX para eventos publicados pelo módulo NMS (`netx-nms.*`) — o
 * lado CONSUMIDOR do canal 3 quando o produtor é o NMS. Fecha o loop
 * bidirecional do ecossistema (NetX↔NMS pelo bus, sem chamada direta).
 *
 * Hoje só registra a recepção. É a SEMENTE da integração de dashboard/alarmes:
 * `netx-nms.device.unreachable` / anomalia óptica devem virar item no Alarm
 * Center; `netx-nms.device.registered` pode reconciliar inventário. Esses
 * ramos entram aqui conforme forem formalizados.
 */
@Injectable()
export class NmsEventsHandler implements EventHandler {
  readonly pattern = 'netx-nms.*';
  private readonly logger = new Logger(NmsEventsHandler.name);

  async handle(env: EventEnvelope): Promise<void> {
    this.logger.log(
      `[NMS→NetX] ${env.type} tenant=${env.tenantId} id=${env.id} payload=${JSON.stringify(env.payload)}`,
    );
    // TODO(ecossistema): rotear netx-nms.device.unreachable → Alarm Center;
    // netx-nms.device.registered → reconciliar inventário de rede.
  }
}
