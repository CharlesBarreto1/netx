import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { EventPublisherService } from '../events/event-publisher.service.js';
import { DeviceJobsService } from '../queue/device-jobs.service.js';
import { DevicesService } from './devices.service.js';

@Injectable()
export class ConnectivityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly devices: DevicesService,
    private readonly audit: AuditService,
    private readonly jobs: DeviceJobsService,
    private readonly events: EventPublisherService,
  ) {}

  /**
   * Testa os três canais de gerência. A API só repassa o ciphertext das credenciais; o
   * gateway decifra e conecta (§4). Nada de SSH/NETCONF aqui dentro.
   */
  async test(deviceId: string, actor: string) {
    const device = await this.devices.findOne(deviceId);
    const cred = await this.prisma.deviceCredential.findUnique({ where: { deviceId } });
    if (!cred) {
      throw new BadRequestException('Cadastre credenciais antes (POST /devices/:id/credentials)');
    }

    const result = await this.jobs.enqueueAndWait(
      {
        jobId: randomUUID(),
        deviceId,
        requestedBy: actor,
        requestedAt: new Date().toISOString(),
        kind: 'connectivity-test',
        params: {
          mgmtIp: device.mgmtIp,
          username: cred.username,
          passwordEnc: cred.passwordEnc ?? undefined,
          snmpCommunityEnc: cred.snmpCommunityEnc ?? undefined,
          vendor: device.vendor,
        },
      },
      { waitMs: 45_000, removeOnComplete: true },
    );

    const data = result.data?.kind === 'connectivity-test' ? result.data : undefined;
    await this.audit.record({
      actor,
      deviceId,
      action: 'device.connectivity-test',
      result: result.ok ? 'ok' : (result.error ?? 'falha'),
      diff: data ? JSON.stringify(data) : undefined,
    });

    // Canal 3 (produtor): fault event quando o device não responde → o NetX
    // transforma em alarme no NOC (real-time). Best-effort, fora do crítico.
    if (!result.ok) {
      void this.events.publish('netx-nms.device.unreachable', {
        deviceId,
        hostname: device.hostname,
        mgmtIp: device.mgmtIp,
        vendor: device.vendor,
        error: result.error ?? 'connectivity-test falhou',
        checks: data ?? null,
      });
    }

    return { deviceId, ok: result.ok, checks: data, error: result.error };
  }
}
