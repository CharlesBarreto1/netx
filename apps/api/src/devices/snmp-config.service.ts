import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { DeviceJobsService } from '../queue/device-jobs.service.js';
import { DevicesService } from './devices.service.js';

@Injectable()
export class SnmpConfigService {
  private readonly logger = new Logger(SnmpConfigService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly devices: DevicesService,
    private readonly audit: AuditService,
    private readonly jobs: DeviceJobsService,
  ) {}

  /**
   * Materializa (ou remove) a config SNMP do Telegraf para o device. A API só repassa o
   * ciphertext da community; o gateway decifra e escreve o arquivo (ADR 0003).
   */
  async syncDevice(deviceId: string, actor: string) {
    const device = await this.devices.findOne(deviceId);
    const cred = await this.prisma.deviceCredential.findUnique({ where: { deviceId } });

    const result = await this.jobs.enqueueAndWait({
      jobId: randomUUID(),
      deviceId,
      requestedBy: actor,
      requestedAt: new Date().toISOString(),
      kind: 'sync-snmp-config',
      params: {
        mgmtIp: device.mgmtIp,
        snmpCommunityEnc: cred?.snmpCommunityEnc ?? undefined,
        snmpVersion: 2,
      },
    });

    const action = result.data?.kind === 'sync-snmp-config' ? result.data.action : undefined;
    await this.audit.record({
      actor,
      deviceId,
      action: 'device.snmp-config.sync',
      result: result.ok ? (action ?? 'ok') : (result.error ?? 'falha'),
    });
    return { deviceId, action };
  }

  /** Versão tolerante a falha para disparo automático (não derruba o fluxo que chamou). */
  async syncDeviceQuietly(deviceId: string, actor: string): Promise<void> {
    try {
      await this.syncDevice(deviceId, actor);
    } catch (err) {
      this.logger.warn(`sync SNMP do device ${deviceId} falhou: ${String(err)}`);
    }
  }
}
