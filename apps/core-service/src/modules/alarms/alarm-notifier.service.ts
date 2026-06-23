/**
 * AlarmNotifier — push (Expo) para incidents críticos (Fase 3). Best-effort:
 * busca os pushTokens dos devices do tenant e dispara via Expo Push API. Sem
 * dependência de SDK (fetch). Falha só loga.
 *
 * @provenance Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=
 */
import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AlarmNotifier {
  private readonly logger = new Logger(AlarmNotifier.name);

  constructor(private readonly prisma: PrismaService) {}

  async notifyCritical(input: {
    tenantId: string;
    title: string;
    body: string;
    incidentId: string;
  }): Promise<void> {
    try {
      const devices = await this.prisma.mobileDevice.findMany({
        where: { tenantId: input.tenantId, pushToken: { not: null } },
        select: { pushToken: true },
        take: 500,
      });
      const tokens = devices
        .map((d) => d.pushToken)
        .filter((t): t is string => !!t && t.startsWith('ExponentPushToken'));
      if (tokens.length === 0) return;

      const messages = tokens.map((to) => ({
        to,
        title: input.title,
        body: input.body,
        sound: 'default',
        priority: 'high',
        data: { kind: 'alarm', incidentId: input.incidentId },
      }));

      const resp = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(messages),
        signal: AbortSignal.timeout(8_000),
      });
      if (!resp.ok) {
        this.logger.warn(`[push] Expo ${resp.status}: ${(await resp.text()).slice(0, 160)}`);
      }
    } catch (err) {
      this.logger.warn(
        `[push] notifyCritical falhou: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
