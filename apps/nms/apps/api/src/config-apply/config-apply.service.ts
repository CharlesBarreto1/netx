import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { DeviceJobsService } from '../queue/device-jobs.service.js';
import { DevicesService } from '../devices/devices.service.js';

/**
 * Pipeline de ESCRITA de config: plan → apply → confirm. Cada passo passa pela fila →
 * device-gateway (nunca SSH/NETCONF no request — §3). Todo job de escrita carrega
 * `approvedBy` = operador autenticado (a fila/safety recusa escrita sem aprovação humana).
 * A IA nunca dispara estes fluxos (§1).
 */
@Injectable()
export class ConfigApplyService {
  private readonly logger = new Logger(ConfigApplyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly devices: DevicesService,
    private readonly audit: AuditService,
    private readonly jobs: DeviceJobsService,
  ) {}

  private async deviceAndCred(deviceId: string) {
    const device = await this.devices.findOne(deviceId);
    const cred = await this.prisma.deviceCredential.findUnique({ where: { deviceId } });
    if (!cred?.passwordEnc) {
      throw new BadRequestException('Cadastre credenciais (senha) antes de aplicar config');
    }
    return { device, cred };
  }

  /** Calcula o diff sem efetivar (dry-run). Não muda nada no equipamento. */
  async plan(deviceId: string, config: string, actor: string) {
    const { device, cred } = await this.deviceAndCred(deviceId);

    const result = await this.jobs.enqueueAndWait(
      {
        jobId: randomUUID(),
        deviceId,
        requestedBy: actor,
        requestedAt: new Date().toISOString(),
        kind: 'apply-config',
        accessMode: 'write',
        approvedBy: actor,
        params: {
          mgmtIp: device.mgmtIp,
          username: cred.username,
          passwordEnc: cred.passwordEnc,
          vendor: device.vendor,
          config,
          dryRun: true,
        },
      },
      { waitMs: 60_000, removeOnComplete: true },
    );

    const data = result.data?.kind === 'apply-config' ? result.data : undefined;
    await this.audit.record({
      actor,
      deviceId,
      action: 'device.config.plan',
      diff: data?.diff,
      result: result.ok ? 'ok' : (result.error ?? 'falha'),
    });

    if (!result.ok || !data) {
      throw new BadRequestException(`Plan falhou: ${result.error ?? 'resposta inesperada'}`);
    }
    return { deviceId, ok: data.ok, diff: data.diff ?? '', detail: data.detail };
  }

  /** Aplica a config com rollback automático armado (commit confirmed / auto-revert). */
  async apply(deviceId: string, config: string, confirmMinutes: number, actor: string) {
    const { device, cred } = await this.deviceAndCred(deviceId);

    const result = await this.jobs.enqueueAndWait(
      {
        jobId: randomUUID(),
        deviceId,
        requestedBy: actor,
        requestedAt: new Date().toISOString(),
        kind: 'apply-config',
        accessMode: 'write',
        approvedBy: actor,
        params: {
          mgmtIp: device.mgmtIp,
          username: cred.username,
          passwordEnc: cred.passwordEnc,
          vendor: device.vendor,
          config,
          confirmMinutes,
          dryRun: false,
        },
      },
      { waitMs: 90_000, removeOnComplete: true },
    );

    const data = result.data?.kind === 'apply-config' ? result.data : undefined;
    await this.audit.record({
      actor,
      deviceId,
      action: 'device.config.apply',
      diff: data?.diff,
      result: result.ok ? (data?.committed ? 'aplicado (pendente confirm)' : 'ok') : (result.error ?? 'falha'),
    });

    if (!result.ok || !data) {
      throw new BadRequestException(`Apply falhou: ${result.error ?? 'resposta inesperada'}`);
    }
    this.logger.log(
      `apply ${device.hostname} (${device.vendor}) por ${actor}: committed=${data.committed}`,
    );
    return {
      deviceId,
      ok: data.ok,
      committed: data.committed ?? false,
      rolledBack: data.rolledBack ?? false,
      diff: data.diff ?? '',
      detail: data.detail,
      confirmMinutes,
    };
  }

  /** Confirma um apply pendente — trava o rollback automático. */
  async confirm(deviceId: string, actor: string) {
    const { device, cred } = await this.deviceAndCred(deviceId);

    const result = await this.jobs.enqueueAndWait(
      {
        jobId: randomUUID(),
        deviceId,
        requestedBy: actor,
        requestedAt: new Date().toISOString(),
        kind: 'confirm-commit',
        accessMode: 'write',
        approvedBy: actor,
        params: {
          mgmtIp: device.mgmtIp,
          username: cred.username,
          passwordEnc: cred.passwordEnc,
          vendor: device.vendor,
        },
      },
      { waitMs: 45_000, removeOnComplete: true },
    );

    const data = result.data?.kind === 'confirm-commit' ? result.data : undefined;
    await this.audit.record({
      actor,
      deviceId,
      action: 'device.config.confirm',
      result: result.ok ? 'ok' : (result.error ?? 'falha'),
    });

    if (!result.ok || !data) {
      throw new BadRequestException(`Confirm falhou: ${result.error ?? 'resposta inesperada'}`);
    }
    return { deviceId, ok: data.ok, detail: data.detail };
  }
}
