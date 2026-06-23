import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { DeviceJobsService } from '../queue/device-jobs.service.js';
import { DevicesService } from './devices.service.js';

@Injectable()
export class ConnectivityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly devices: DevicesService,
    private readonly audit: AuditService,
    private readonly jobs: DeviceJobsService,
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

    return { deviceId, ok: result.ok, checks: data, error: result.error };
  }
}
