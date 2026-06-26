import { Injectable, Logger } from '@nestjs/common';

import type { EventEnvelope } from '@netx/core-sdk';

import { AlarmStream } from '../alarms/alarm-stream.service';
import type { EventHandler } from './event-handler';

interface NmsDevicePayload {
  deviceId?: string;
  hostname?: string;
  mgmtIp?: string;
  vendor?: string;
  error?: string;
  [k: string]: unknown;
}

/**
 * Handler do NetX para eventos publicados pelo módulo NMS (`netx-nms.*`) — o
 * lado CONSUMIDOR do canal 3 quando o produtor é o NMS. Fecha o loop
 * bidirecional do ecossistema (NetX↔NMS pelo bus, sem chamada direta).
 *
 * `netx-nms.device.unreachable` vira um alarme de DEVICE DE REDE no NOC
 * real-time (AlarmStream, tipo `nms-device`). NÃO usa o IncidentCorrelator: ele
 * é ONT-cêntrico (correlação por PON/CTO/cabo) e um roteador de rede não tem
 * essa cadeia — alarme de device de rede é um plano distinto. Persistência em
 * tabela própria de alarmes de rede é follow-up.
 */
@Injectable()
export class NmsEventsHandler implements EventHandler {
  readonly pattern = 'netx-nms.*';
  private readonly logger = new Logger(NmsEventsHandler.name);

  constructor(private readonly stream: AlarmStream) {}

  async handle(env: EventEnvelope): Promise<void> {
    const p = (env.payload ?? {}) as NmsDevicePayload;
    this.logger.log(
      `[NMS→NetX] ${env.type} tenant=${env.tenantId} id=${env.id} payload=${JSON.stringify(env.payload)}`,
    );

    if (env.type === 'netx-nms.device.unreachable') {
      // Alarme real-time no NOC (painel/mobile assinam /v1/alarms/stream).
      this.stream.publish(env.tenantId, 'nms-device', {
        source: 'nms',
        kind: 'device-unreachable',
        severity: 'CRITICAL',
        deviceId: p.deviceId,
        hostname: p.hostname,
        mgmtIp: p.mgmtIp,
        vendor: p.vendor,
        detail: p.error,
        at: env.occurredAt,
      });
    }
    // netx-nms.device.registered → reconciliar inventário de rede (follow-up).
  }
}
