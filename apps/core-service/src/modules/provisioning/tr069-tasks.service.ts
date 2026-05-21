/**
 * Tr069TasksService — Fase 1 stub. Persiste Tr069Tasks PENDING que apps/cwmp-server
 * (Fase 3) vai consumir e entregar pros CPEs no fim do session Inform.
 *
 * Por hora as tasks ficam em status PENDING indefinidamente — não há applier
 * real. UI mostra "aguardando CWMP server" pro técnico/admin.
 *
 * Quando Fase 3 chegar, o ACS faz:
 *   1. CPE conecta (Inform)
 *   2. ACS busca tasks PENDING desse deviceId (FIFO por createdAt)
 *   3. Marca status=RUNNING, envia RPC, aguarda response
 *   4. Marca DONE ou FAILED conforme fault code
 *
 * @provenance Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=
 */
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Tr069TaskAction, Tr069TaskStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

/** Data model paths Huawei EG8145V5/X10 (Customized HGW DataModel). */
export const HUAWEI_EG8145_PATHS = {
  // SSID 2.4GHz e 5GHz (X10 tem ambos; V5 tem ambos em algumas firmwares)
  ssid24:
    'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID',
  ssid50:
    'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.SSID',
  pwd24:
    'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.PreSharedKey.1.PreSharedKey',
  pwd50:
    'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.PreSharedKey.1.PreSharedKey',
  // Security mode (WPA2-PSK)
  sec24:
    'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.X_HW_SecurityMode',
  sec50:
    'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.X_HW_SecurityMode',
  // Inform interval — reduzir após primeira config pra próxima sessão ser rápida
  informInterval:
    'InternetGatewayDevice.ManagementServer.PeriodicInformInterval',
} as const;

interface SetWifiInput {
  ssid: string;
  password: string;
  /** Se true, aplica em ambos 2.4G e 5G simultâneo. Default true. */
  bothBands?: boolean;
}

@Injectable()
export class Tr069TasksService {
  private readonly logger = new Logger(Tr069TasksService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Enfileira task SET_PARAMS pra aplicar SSID + senha Wi-Fi.
   * Cria Tr069Device placeholder se ainda não existe (Inform virá depois).
   */
  async enqueueSetWifi(
    tenantId: string,
    ontId: string,
    contractId: string,
    snGpon: string,
    input: SetWifiInput,
  ): Promise<{ taskId: string; deviceId: string }> {
    // Device id Huawei segue padrão "<OUI>-<SerialNumber>". OUI da Huawei
    // (Huawei Technologies) é "00259E". Como ainda não recebemos Inform
    // (não sabemos o serial real reportado), usamos placeholder estável
    // baseado no SN GPON. Quando Inform chegar, o servidor CWMP faz upsert
    // pelo deviceId real.
    const deviceIdPlaceholder = `00259E-${snGpon.toUpperCase()}`;

    const device = await this.prisma.tr069Device.upsert({
      where: { deviceId: deviceIdPlaceholder },
      create: {
        tenantId,
        ontId,
        deviceId: deviceIdPlaceholder,
        manufacturer: 'Huawei',
        oui: '00259E',
        status: 'UNKNOWN',
      },
      update: { ontId, tenantId },
    });

    const bothBands = input.bothBands ?? true;
    const params: Array<{ name: string; value: string; type: 'xsd:string' | 'xsd:unsignedInt' }> = [
      { name: HUAWEI_EG8145_PATHS.ssid24, value: input.ssid, type: 'xsd:string' },
      { name: HUAWEI_EG8145_PATHS.pwd24, value: input.password, type: 'xsd:string' },
    ];
    if (bothBands) {
      params.push(
        { name: HUAWEI_EG8145_PATHS.ssid50, value: input.ssid + '-5G', type: 'xsd:string' },
        { name: HUAWEI_EG8145_PATHS.pwd50, value: input.password, type: 'xsd:string' },
      );
    }
    // Acelera o próximo Inform pra ACS confirmar config rapidamente (60s).
    // Default Huawei é 86400 (1 dia) — terrível pra ZTP.
    params.push({
      name: HUAWEI_EG8145_PATHS.informInterval,
      value: '60',
      type: 'xsd:unsignedInt',
    });

    const task = await this.prisma.tr069Task.create({
      data: {
        tenantId,
        deviceId: device.id,
        contractId,
        action: 'SET_PARAMS',
        payload: { params },
        status: 'PENDING',
      },
    });

    this.logger.log(
      `[TR-069] enqueued SET_PARAMS task=${task.id} device=${deviceIdPlaceholder} ` +
        `params=${params.length} (Fase 3 ACS aplica)`,
    );
    return { taskId: task.id, deviceId: device.id };
  }

  /** Enfileira REBOOT. Idealmente disparado após SET_PARAMS quando model exige. */
  async enqueueReboot(
    tenantId: string,
    deviceDbId: string,
    contractId: string | null,
  ): Promise<{ taskId: string }> {
    const task = await this.prisma.tr069Task.create({
      data: {
        tenantId,
        deviceId: deviceDbId,
        contractId,
        action: 'REBOOT',
        payload: {},
        status: 'PENDING',
      },
    });
    return { taskId: task.id };
  }

  /** Lista tasks de um device (UI admin). */
  async listForDevice(tenantId: string, deviceDbId: string) {
    return this.prisma.tr069Task.findMany({
      where: { tenantId, deviceId: deviceDbId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  /** Cancela task PENDING (admin override). */
  async cancelTask(tenantId: string, taskId: string): Promise<void> {
    const t = await this.prisma.tr069Task.findFirst({
      where: { id: taskId, tenantId },
    });
    if (!t) throw new NotFoundException('Task não encontrada');
    if (t.status !== 'PENDING') {
      throw new Error(`Task em status ${t.status} — só PENDING pode ser cancelada`);
    }
    await this.prisma.tr069Task.update({
      where: { id: taskId },
      data: { status: 'CANCELLED' as Tr069TaskStatus },
    });
  }

  /** Stub: lista devices (UI admin /tr069/devices). */
  async listDevices(tenantId: string) {
    return this.prisma.tr069Device.findMany({
      where: { tenantId },
      orderBy: { lastInformAt: { sort: 'desc', nulls: 'last' } },
      take: 100,
      include: {
        ont: { select: { id: true, snGpon: true, contractId: true } },
        _count: { select: { tasks: true } },
      },
    });
  }
}

/** Re-export pra typing em outros services. */
export type { Tr069TaskAction };
