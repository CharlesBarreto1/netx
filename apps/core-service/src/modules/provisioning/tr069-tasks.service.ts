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
import { randomBytes } from 'node:crypto';

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Tr069TaskAction, Tr069TaskStatus } from '@prisma/client';

import { CryptoService } from '../crypto/crypto.service';
import { PrismaService } from '../prisma/prisma.service';
import { HUAWEI_EG8145_PATHS, HUAWEI_IPV6_ADDR_ORIGIN, ssid5gFor } from './tr069-paths.huawei';

// Re-export pra compat com código existente que importava daqui
export { HUAWEI_EG8145_PATHS, ssid5gFor };

interface SetWifiInput {
  ssid: string;
  password: string;
  /** Se true, aplica em ambos 2.4G e 5G simultâneo. Default true. */
  bothBands?: boolean;
  /**
   * Modo de Wi-Fi (depende do modelo da ONT):
   *   BAND_STEERING — SSID único nas 2 bandas (EG8145X6/X10).
   *   DUAL_BAND     — 5G ganha sufixo "-5G" (EG8145V5), ex.: "Charles-5G".
   * Default BAND_STEERING.
   */
  wifiBandMode?: 'BAND_STEERING' | 'DUAL_BAND';
  /**
   * Credencial PPPoE opcional. Quando o contrato é PPPoE, o ZTP injeta o
   * usuário/senha na WAN de internet da ONT via TR-069 — assim o técnico
   * não configura nada no equipamento. A ONT disca PPPoE sozinha.
   *
   * `vlan`: VLAN 802.1Q da WAN PPPoE (default 1010).
   */
  pppoe?: { username: string; password: string; vlan: number };
}


@Injectable()
export class Tr069TasksService {
  private readonly logger = new Logger(Tr069TasksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

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
    type ParamType = 'xsd:string' | 'xsd:unsignedInt' | 'xsd:boolean';
    const params: Array<{ name: string; value: string; type: ParamType }> = [
      { name: HUAWEI_EG8145_PATHS.ssid24, value: input.ssid, type: 'xsd:string' },
      { name: HUAWEI_EG8145_PATHS.pwd24, value: input.password, type: 'xsd:string' },
    ];
    if (bothBands) {
      // 5GHz: SSID único (band steering) ou nome+"-5G" (dual band).
      const ssid5g = ssid5gFor(input.ssid, input.wifiBandMode ?? 'BAND_STEERING');
      params.push(
        { name: HUAWEI_EG8145_PATHS.ssid50, value: ssid5g, type: 'xsd:string' },
        { name: HUAWEI_EG8145_PATHS.pwd50, value: input.password, type: 'xsd:string' },
      );
    }

    // ZTP PPPoE: injeta credencial + VLAN + IPv6 na WAN de internet da ONT.
    // A ONT (modo roteador) disca PPPoE sozinha — técnico não toca em rede.
    if (input.pppoe) {
      params.push(
        { name: HUAWEI_EG8145_PATHS.pppoeUsername, value: input.pppoe.username, type: 'xsd:string' },
        { name: HUAWEI_EG8145_PATHS.pppoePassword, value: input.pppoe.password, type: 'xsd:string' },
        // VLAN 802.1Q da WAN PPPoE — o preset já traz, reaplica por garantia.
        { name: HUAWEI_EG8145_PATHS.pppoeVlan, value: String(input.pppoe.vlan), type: 'xsd:unsignedInt' },
        // IPv6 dual-stack: ONT negocia /64 (WAN) + /56 (PD) — ambos vêm do RADIUS.
        { name: HUAWEI_EG8145_PATHS.ipv6Enable, value: '1', type: 'xsd:boolean' },
        // IP Acquisition Mode = Automatic (não DHCPv6). Corrige o default errado
        // do preset de fábrica/Ufinet — sem isso o IPv6 não é entregue. ⚠️ só
        // aplica após reboot (o provisionamento reinicia logo após este SET).
        { name: HUAWEI_EG8145_PATHS.ipv6AddrOrigin, value: HUAWEI_IPV6_ADDR_ORIGIN, type: 'xsd:string' },
        { name: HUAWEI_EG8145_PATHS.pppoeEnable, value: '1', type: 'xsd:boolean' },
      );
      this.logger.log(
        `[TR-069] ZTP PPPoE — injetando credencial user=${input.pppoe.username} ` +
          `vlan=${input.pppoe.vlan} + IPv6 dual-stack na ONT`,
      );
    }

    // Acelera o próximo Inform pra ACS confirmar config rapidamente (60s).
    // Default Huawei é 86400 (1 dia) — terrível pra ZTP.
    params.push({
      name: HUAWEI_EG8145_PATHS.informInterval,
      value: '60',
      type: 'xsd:unsignedInt',
    });

    // Credenciais de Connection Request: o ACS precisa delas pra acordar a ONT
    // (ACS→CPE) via HTTP Digest. Setamos no ZTP (proativo, não preguiçoso) e
    // guardamos cifrado no device — reusa as existentes em re-provisionamento.
    // São params standard TR-098 (ManagementServer.*), seguros em qualquer firmware.
    let crUser: string;
    let crPass: string;
    if (device.connectionRequestUser && device.connectionRequestPwdEnc) {
      crUser = device.connectionRequestUser;
      crPass = this.crypto.decrypt(device.connectionRequestPwdEnc);
    } else {
      crUser = `netx-${device.id.slice(0, 8)}`;
      crPass = randomBytes(12).toString('hex');
      await this.prisma.tr069Device.update({
        where: { id: device.id },
        data: {
          connectionRequestUser: crUser,
          connectionRequestPwdEnc: this.crypto.encrypt(crPass),
        },
      });
    }
    params.push(
      { name: HUAWEI_EG8145_PATHS.connReqUsername, value: crUser, type: 'xsd:string' },
      { name: HUAWEI_EG8145_PATHS.connReqPassword, value: crPass, type: 'xsd:string' },
    );

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
    // Multi-tenancy estrito: garante que o device é deste tenant antes de
    // enfileirar (evita criar task cruzando tenants via id arbitrário).
    const device = await this.prisma.tr069Device.findFirst({
      where: { id: deviceDbId, tenantId },
      select: { id: true },
    });
    if (!device) throw new NotFoundException('Device TR-069 não encontrado');

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

  /**
   * Enfileira um Download de firmware (RPC Download). O CPE baixa da URL e
   * aplica; ao terminar manda TransferComplete (o ACS fecha a task).
   */
  async enqueueFirmwareUpgrade(
    tenantId: string,
    deviceDbId: string,
    input: { url: string; fileType?: string; targetFileName?: string },
  ): Promise<{ taskId: string }> {
    const device = await this.prisma.tr069Device.findFirst({
      where: { id: deviceDbId, tenantId },
      select: { id: true },
    });
    if (!device) throw new NotFoundException('Device TR-069 não encontrado');
    const task = await this.prisma.tr069Task.create({
      data: {
        tenantId,
        deviceId: deviceDbId,
        action: 'DOWNLOAD',
        payload: {
          url: input.url,
          fileType: input.fileType ?? '1 Firmware Upgrade Image',
          ...(input.targetFileName ? { targetFileName: input.targetFileName } : {}),
        },
        status: 'PENDING',
      },
    });
    this.logger.log(`[TR-069] firmware Download enfileirado device=${deviceDbId} url=${input.url}`);
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
