import { randomUUID } from 'node:crypto';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { DeviceJobsService } from '../queue/device-jobs.service.js';

/** Manutenção do coletor, não ação sobre um device (mesmo sentinela do network-test host). */
const NIL_UUID = '00000000-0000-0000-0000-000000000000';

/** A varredura mexe em N arquivos e roda no boot — mais folga que o sync de um device. */
const RECONCILE_WAIT_MS = 60_000;

@Injectable()
export class SnmpConfigService {
  private readonly logger = new Logger(SnmpConfigService.name);

  // Fala com o banco direto (e não via DevicesService) porque o DevicesService depende
  // deste serviço para limpar o perfil no delete — injetar de volta faria ciclo.
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly jobs: DeviceJobsService,
  ) {}

  /**
   * Materializa (ou remove) a config SNMP do Telegraf para o device. A API só repassa o
   * ciphertext da community; o gateway decifra e escreve o arquivo (ADR 0003).
   */
  async syncDevice(deviceId: string, actor: string) {
    const device = await this.prisma.device.findUnique({ where: { id: deviceId } });
    if (!device) throw new NotFoundException(`Device ${deviceId} não encontrado`);
    const cred = await this.prisma.deviceCredential.findUnique({ where: { deviceId } });

    return this.enqueueSync(deviceId, actor, {
      mgmtIp: device.mgmtIp,
      snmpCommunityEnc: cred?.snmpCommunityEnc ?? undefined,
      vendor: device.vendor,
    });
  }

  /** Versão tolerante a falha para disparo automático (não derruba o fluxo que chamou). */
  async syncDeviceQuietly(deviceId: string, actor: string): Promise<void> {
    try {
      await this.syncDevice(deviceId, actor);
    } catch (err) {
      this.logger.warn(`sync SNMP do device ${deviceId} falhou: ${String(err)}`);
    }
  }

  /**
   * Apaga o perfil do Telegraf de um device que acabou de ser removido. Não consulta o
   * banco (a linha já não existe): recebe o `mgmtIp` capturado antes do delete. Sem
   * `snmpCommunityEnc` o gateway apaga o arquivo em vez de reescrevê-lo.
   *
   * Sem isso o Telegraf segue pollando o IP para sempre — e a community antiga continua
   * em texto claro dentro de `telegraf.d`, mesmo depois de a credencial sumir do banco.
   */
  async removeDevice(deviceId: string, mgmtIp: string, actor: string) {
    return this.enqueueSync(deviceId, actor, { mgmtIp }, { deviceStillExists: false });
  }

  /** Tolerante a falha: gateway fora do ar não pode impedir o delete do device. */
  async removeDeviceQuietly(deviceId: string, mgmtIp: string, actor: string): Promise<void> {
    try {
      await this.removeDevice(deviceId, mgmtIp, actor);
    } catch (err) {
      this.logger.warn(`remoção do perfil SNMP do device ${deviceId} falhou: ${String(err)}`);
    }
  }

  /**
   * Varre o `telegraf.d` e apaga os perfis cujo device não existe mais. Rede de segurança
   * para o que já vazou: instalações anteriores ao delete que limpa, e deletes feitos com
   * o gateway fora do ar. Devolve `null` quando a varredura é pulada.
   */
  async reconcile(actor: string): Promise<{ removed: string[]; kept: number } | null> {
    const devices = await this.prisma.device.findMany({ select: { id: true } });
    if (devices.length === 0) {
      // Com o banco vazio não dá para distinguir "parque vazio" de "leitura falhou", e o
      // estrago seria parar a coleta inteira. O gateway recusa a lista vazia do mesmo jeito.
      this.logger.log('reconciliação de perfis SNMP pulada: nenhum device no banco');
      return null;
    }

    const result = await this.jobs.enqueueAndWait(
      {
        jobId: randomUUID(),
        deviceId: NIL_UUID,
        requestedBy: actor,
        requestedAt: new Date().toISOString(),
        kind: 'reconcile-snmp-configs',
        params: { knownDeviceIds: devices.map((d) => d.id) },
      },
      { waitMs: RECONCILE_WAIT_MS },
    );

    const data = result.data?.kind === 'reconcile-snmp-configs' ? result.data : undefined;
    await this.audit.record({
      actor,
      action: 'device.snmp-config.reconcile',
      diff: data ? JSON.stringify({ removed: data.removed, kept: data.kept }) : undefined,
      result: result.ok
        ? `${data?.removed.length ?? 0} órfão(s) removido(s)`
        : (result.error ?? 'falha'),
    });
    if (data?.removed.length) {
      this.logger.warn(`perfis SNMP órfãos removidos: ${data.removed.join(', ')}`);
    }
    return data ? { removed: data.removed, kept: data.kept } : null;
  }

  /** Tolerante a falha: usada no boot, onde o gateway pode ainda não estar de pé. */
  async reconcileQuietly(actor: string): Promise<void> {
    try {
      await this.reconcile(actor);
    } catch (err) {
      this.logger.warn(`reconciliação de perfis SNMP falhou: ${String(err)}`);
    }
  }

  private async enqueueSync(
    deviceId: string,
    actor: string,
    params: { mgmtIp: string; snmpCommunityEnc?: string; vendor?: string },
    opts: { deviceStillExists: boolean } = { deviceStillExists: true },
  ) {
    const result = await this.jobs.enqueueAndWait({
      jobId: randomUUID(),
      deviceId,
      requestedBy: actor,
      requestedAt: new Date().toISOString(),
      kind: 'sync-snmp-config',
      params: { snmpVersion: 2, ...params },
    });

    const action = result.data?.kind === 'sync-snmp-config' ? result.data.action : undefined;
    await this.audit.record({
      actor,
      // AuditLog.deviceId tem FK para device: depois do delete a linha não existe mais e
      // o insert quebraria. Nesse caso o id vai no diff, como em `device.delete`.
      deviceId: opts.deviceStillExists ? deviceId : undefined,
      action: 'device.snmp-config.sync',
      diff: opts.deviceStillExists ? undefined : JSON.stringify({ deviceId }),
      result: result.ok ? (action ?? 'ok') : (result.error ?? 'falha'),
    });
    return { deviceId, action };
  }
}
