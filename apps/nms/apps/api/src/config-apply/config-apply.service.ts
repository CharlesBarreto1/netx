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
 *
 * O ciclo de vida fica persistido em `ConfigChange` (com verify automático pós-apply), pra
 * UI acompanhar mesmo se o operador recarregar a página, e o `AuditLog` guarda a ação imutável.
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

  /** Resolve device + credencial (com senha cifrada garantida). Narrowing de passwordEnc aqui. */
  private async deviceAndCred(deviceId: string) {
    const device = await this.devices.findOne(deviceId);
    const cred = await this.prisma.deviceCredential.findUnique({ where: { deviceId } });
    if (!cred?.passwordEnc) {
      throw new BadRequestException('Cadastre credenciais (senha) antes de aplicar config');
    }
    return { device, username: cred.username, passwordEnc: cred.passwordEnc };
  }

  /** Calcula o diff sem efetivar (dry-run). Não muda nada no equipamento. */
  async plan(deviceId: string, config: string, actor: string) {
    const { device, username, passwordEnc } = await this.deviceAndCred(deviceId);

    const result = await this.jobs.enqueueAndWait(
      {
        jobId: randomUUID(),
        deviceId,
        requestedBy: actor,
        requestedAt: new Date().toISOString(),
        kind: 'apply-config',
        accessMode: 'write',
        approvedBy: actor,
        params: { mgmtIp: device.mgmtIp, username, passwordEnc, vendor: device.vendor, config, dryRun: true },
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

  /** Aplica a config com rollback automático armado, registra a mudança e roda verify. */
  async apply(deviceId: string, config: string, confirmMinutes: number, actor: string) {
    const { device, username, passwordEnc } = await this.deviceAndCred(deviceId);

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
          username,
          passwordEnc,
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
      await this.prisma.configChange.create({
        data: { deviceId, actor, status: 'failed', config, detail: result.error ?? 'falha' },
      });
      throw new BadRequestException(`Apply falhou: ${result.error ?? 'resposta inesperada'}`);
    }

    // Sem mudança real (diff vazio) → nada a confirmar/reverter.
    if (!data.committed) {
      return {
        deviceId,
        ok: data.ok,
        committed: false,
        rolledBack: data.rolledBack ?? false,
        diff: data.diff ?? '',
        detail: data.detail,
        confirmMinutes,
        changeId: null as string | null,
        verify: null as { ok: boolean; detail: string } | null,
      };
    }

    // Verify automático: o equipamento ainda responde SSH após a mudança? (best-effort)
    const verify = await this.verify(device.id, device.mgmtIp, username, passwordEnc, device.vendor);

    const change = await this.prisma.configChange.create({
      data: {
        deviceId,
        actor,
        status: 'applied',
        config,
        diff: data.diff ?? null,
        detail: data.detail,
        confirmMinutes,
        confirmDeadline: new Date(Date.now() + confirmMinutes * 60_000),
        verifyOk: verify.ok,
        verifyDetail: verify.detail,
      },
    });

    this.logger.log(
      `apply ${device.hostname} (${device.vendor}) por ${actor}: change=${change.id} verify=${verify.ok}`,
    );
    return {
      deviceId,
      ok: data.ok,
      committed: true,
      rolledBack: data.rolledBack ?? false,
      diff: data.diff ?? '',
      detail: data.detail,
      confirmMinutes,
      changeId: change.id,
      verify,
    };
  }

  /** Confirma o apply pendente — trava o rollback automático e marca a mudança como confirmada. */
  async confirm(deviceId: string, actor: string) {
    const { device, username, passwordEnc } = await this.deviceAndCred(deviceId);

    const result = await this.jobs.enqueueAndWait(
      {
        jobId: randomUUID(),
        deviceId,
        requestedBy: actor,
        requestedAt: new Date().toISOString(),
        kind: 'confirm-commit',
        accessMode: 'write',
        approvedBy: actor,
        params: { mgmtIp: device.mgmtIp, username, passwordEnc, vendor: device.vendor },
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

    const pending = await this.prisma.configChange.findFirst({
      where: { deviceId, status: 'applied' },
      orderBy: { createdAt: 'desc' },
    });
    if (pending) {
      await this.prisma.configChange.update({
        where: { id: pending.id },
        data: { status: 'confirmed', detail: data.detail },
      });
    }
    return { deviceId, ok: data.ok, detail: data.detail, changeId: pending?.id ?? null };
  }

  /** Histórico de mudanças de config do device. */
  async listChanges(deviceId: string) {
    await this.devices.findOne(deviceId);
    return this.prisma.configChange.findMany({
      where: { deviceId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        status: true,
        actor: true,
        detail: true,
        confirmMinutes: true,
        confirmDeadline: true,
        verifyOk: true,
        verifyDetail: true,
        createdAt: true,
      },
    });
  }

  /** Mudança aplicada e ainda não confirmada (UI mostra o aviso de rollback pendente). */
  async pendingChange(deviceId: string) {
    await this.devices.findOne(deviceId);
    return this.prisma.configChange.findFirst({
      where: { deviceId, status: 'applied' },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Verify pós-apply: roda um connectivity-test (read) e olha o canal SSH. Best-effort. */
  private async verify(
    deviceId: string,
    mgmtIp: string,
    username: string,
    passwordEnc: string,
    vendor: string,
  ): Promise<{ ok: boolean; detail: string }> {
    try {
      const r = await this.jobs.enqueueAndWait(
        {
          jobId: randomUUID(),
          deviceId,
          requestedBy: 'system-verify',
          requestedAt: new Date().toISOString(),
          kind: 'connectivity-test',
          params: { mgmtIp, username, passwordEnc, vendor },
        },
        { waitMs: 45_000, removeOnComplete: true },
      );
      const d = r.data?.kind === 'connectivity-test' ? r.data : undefined;
      const ssh = d?.ssh?.reachable ?? false;
      return {
        ok: ssh,
        detail: ssh
          ? 'SSH acessível após o apply'
          : 'SSH não respondeu após o apply — confirme com cautela (o equipamento pode reverter sozinho)',
      };
    } catch (e) {
      return { ok: false, detail: `verify não concluiu: ${String(e)}` };
    }
  }
}
