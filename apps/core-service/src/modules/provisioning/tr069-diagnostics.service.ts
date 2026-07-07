/**
 * Tr069DiagnosticsService — monitoramento proativo de CPEs via TR-069.
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Responsabilidades:
 *   - Enfileirar GET_PARAMS de diagnóstico (níveis ópticos + Wi-Fi). O
 *     apps/cwmp-server entrega no próximo Inform e, ao receber a resposta,
 *     grava o Tr069Diagnostic + avalia alertas ópticos.
 *   - Coleta PROATIVA: cron que enfileira diagnóstico pros devices ONLINE em
 *     intervalo configurável, sem precisar do operador clicar.
 *   - Detecção de OFFLINE: cron que marca CPEs que pararam de fazer Inform e
 *     abre alerta DEVICE_OFFLINE (resolvido pelo ACS quando o CPE volta).
 *   - Leitura pra UI: detalhe do device, série temporal e lista de alertas.
 *
 * @provenance Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=
 */
import { randomBytes } from 'node:crypto';

import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import {
  paginationMeta,
  type ListTr069AlertsQuery,
  type Paginated,
  type Tr069AlertDto,
  type Tr069DashboardResponse,
  type Tr069DeviceDetailResponse,
  type Tr069DiagnosticDto,
  type Tr069DiagRunDto,
  type Tr069LanHost,
  type Tr069RefreshResponse,
  type ListWifiCoverageQuery,
  type WifiCoverageRow,
  type Tr069TaskDto,
  type Tr069WifiClient,
  type Tr069DeviceNoteDto,
  type Tr069DeviceHistoryResponse,
  type Tr069ProbeResultDto,
  type SetWifiRadio,
  type SetRouterSettings,
  type Tr069WifiScanResponse,
  type Tr069WifiNeighbor,
} from '@netx/shared';

import { AuditService } from '../audit/audit.service';
import { CryptoService } from '../crypto/crypto.service';

import { PrismaService } from '../prisma/prisma.service';
import { performConnectionRequest } from './tr069-connection-request';
import {
  HUAWEI_EG8145_PATHS,
  HUAWEI_ROUTER_PATHS,
  HUAWEI_WIFI_SCAN,
  HUAWEI_TX_POWER_LEVELS,
  HUAWEI_WIFI_CHANNELS,
  HUAWEI_WIFI_WIDTH_CODE,
  HUAWEI_WIFI_WIDTHS,
  huaweiWlanPaths,
  huaweiWlanSecurityParams,
  TR143_DOWNLOAD,
  TR143_PING,
  TR143_UPLOAD,
} from './tr069-paths.huawei';
import { diagnosticParamNamesFor, isVsol, notificationAttributesFor } from './tr069-paths.registry';
import { VSOL_WIFI_CHANNELS, vsolWlanPaths, vsolWlanSecurityParams } from './tr069-paths.vsol';

/** Intervalo (min) entre coletas proativas por device. */
const DIAGNOSTIC_INTERVAL_MIN = parseInt(process.env.TR069_DIAGNOSTIC_INTERVAL_MIN ?? '15', 10);
/** Minutos sem Inform até considerar o CPE offline. */
const OFFLINE_AFTER_MIN = parseInt(process.env.TR069_OFFLINE_AFTER_MIN ?? '10', 10);
/** Quantos devices processar por tick de cron (proteção contra varredura gigante). */
const CRON_BATCH = 200;
/** Dias de retenção da série temporal de diagnóstico (limpeza diária). */
const RETENTION_DAYS = parseInt(process.env.TR069_DIAGNOSTIC_RETENTION_DAYS ?? '30', 10);
/** Minutos após o arme até relaxar o PeriodicInformInterval (ZTP rápido → permanente). */
const INFORM_RELAX_AFTER_MIN = parseInt(process.env.TR069_INFORM_RELAX_AFTER_MIN ?? '120', 10);
/** Intervalo permanente de Inform (s) após o relaxamento. Default 5min — base
 *  do motor de conformidade (drift converge em minutos sem depender de CR).
 *  Aumente em parque muito grande se quiser menos carga. */
const INFORM_RELAXED_INTERVAL = parseInt(process.env.TR069_INFORM_RELAXED_INTERVAL ?? '300', 10);

function dec(d: Prisma.Decimal | null): number | null {
  return d === null ? null : Number(d);
}

const NEIGHBOR_RE = /NeighboringWiFiDiagnostic\.Result\.(\d+)\.(.+)$/;

/** Reconstrói a lista de redes vizinhas a partir da subárvore Result.{i}. */
function parseWifiNeighbors(params: Record<string, unknown>): Tr069WifiNeighbor[] {
  const byIdx = new Map<string, Tr069WifiNeighbor>();
  for (const [name, raw] of Object.entries(params)) {
    const m = NEIGHBOR_RE.exec(name);
    if (!m) continue;
    const [, idx, field] = m;
    let n = byIdx.get(idx);
    if (!n) {
      n = { ssid: null, bssid: null, channel: null, band: null, signal: null, bandwidth: null, security: null };
      byIdx.set(idx, n);
    }
    const value = raw == null ? '' : String(raw);
    if (field === 'SSID') n.ssid = value || null;
    else if (field === 'BSSID') n.bssid = value || null;
    else if (field === 'Channel') n.channel = value === '' ? null : Number(value);
    else if (field === 'OperatingFrequencyBand') n.band = value || null;
    else if (field === 'SignalStrength') n.signal = value === '' ? null : Number(value);
    else if (field === 'OperatingChannelBandwidth') n.bandwidth = value || null;
    else if (field === 'SecurityModeEnabled') n.security = value || null;
  }
  return [...byIdx.values()].filter((n) => n.bssid !== null || n.ssid !== null);
}

@Injectable()
export class Tr069DiagnosticsService {
  private readonly logger = new Logger(Tr069DiagnosticsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
  ) {}

  private get enabled(): boolean {
    return (process.env.TR069_DIAGNOSTICS_ENABLED ?? '1') !== '0';
  }

  // ---------------------------------------------------------------------------
  // Enfileiramento de coleta
  // ---------------------------------------------------------------------------

  /**
   * Enfileira um GET_PARAMS de diagnóstico se ainda não houver um pendente/rodando
   * pro device. Retorna o id da task (existente ou nova).
   */
  async enqueueDiagnostics(tenantId: string, deviceDbId: string): Promise<{ taskId: string }> {
    const inflight = await this.prisma.tr069Task.findFirst({
      where: {
        tenantId,
        deviceId: deviceDbId,
        action: 'GET_PARAMS',
        status: { in: ['PENDING', 'RUNNING'] },
      },
      select: { id: true },
    });
    if (inflight) return { taskId: inflight.id };

    // Lista de params do diagnóstico depende do fabricante (Zyxel ≠ Huawei) —
    // senão o CPE devolve Fault 9005 no GET inteiro.
    const device = await this.prisma.tr069Device.findUnique({
      where: { id: deviceDbId },
      select: { manufacturer: true },
    });
    const task = await this.prisma.tr069Task.create({
      data: {
        tenantId,
        deviceId: deviceDbId,
        action: 'GET_PARAMS',
        payload: { names: diagnosticParamNamesFor(device?.manufacturer), purpose: 'DIAGNOSTICS' },
        status: 'PENDING',
      },
    });
    return { taskId: task.id };
  }

  /**
   * Arma as notificações (SetParameterAttributes) no CPE: Status ativo + níveis
   * ópticos passivos. Depois disso os ópticos chegam de carona no Inform — sem
   * GET. Marca notificationsArmedAt (otimista) pra não rearmar toda hora; o
   * polling segue como fallback caso o arme falhe.
   */
  async enqueueArmNotifications(tenantId: string, deviceDbId: string): Promise<{ taskId: string }> {
    const device = await this.prisma.tr069Device.findUnique({
      where: { id: deviceDbId },
      select: { manufacturer: true },
    });
    const task = await this.prisma.tr069Task.create({
      data: {
        tenantId,
        deviceId: deviceDbId,
        action: 'SET_ATTRIBUTES',
        payload: { attributes: notificationAttributesFor(device?.manufacturer) },
        status: 'PENDING',
      },
    });
    await this.prisma.tr069Device.update({
      where: { id: deviceDbId },
      data: { notificationsArmedAt: new Date() },
    });
    return { taskId: task.id };
  }

  /**
   * Pedido manual de refresh (botão na UI). Enfileira a coleta e tenta acionar
   * o CPE via Connection Request pra que a sessão aconteça em segundos; se o
   * CPE for inalcançável (NAT/rede neutra), cai no Periodic Inform.
   */
  async requestRefresh(tenantId: string, deviceId: string): Promise<Tr069RefreshResponse> {
    const device = await this.prisma.tr069Device.findFirst({
      where: { id: deviceId, tenantId },
      select: {
        id: true,
        connectionRequestUrl: true,
        connectionRequestUser: true,
        connectionRequestPwdEnc: true,
      },
    });
    if (!device) throw new NotFoundException('Device TR-069 não encontrado');
    const { taskId } = await this.enqueueDiagnostics(tenantId, device.id);

    if (!device.connectionRequestUrl) {
      return {
        taskId,
        message: 'Coleta enfileirada — será aplicada no próximo Inform (CPE sem URL de acionamento).',
      };
    }

    const creds = await this.ensureConnReqCreds(tenantId, device);
    if (!creds.ready) {
      return {
        taskId,
        message:
          'Coleta enfileirada — credenciais de acionamento sendo aplicadas; o próximo Inform já traz o diagnóstico.',
      };
    }

    const cr = await performConnectionRequest(
      device.connectionRequestUrl,
      creds.username,
      creds.password,
    );
    this.logger.log(
      `[TR-069] connection-request device=${device.id} ok=${cr.ok} ` +
        `status=${cr.status ?? '∅'} reason=${cr.reason ?? '∅'}`,
    );
    return {
      taskId,
      message: cr.ok
        ? 'CPE acionado — diagnóstico chega em instantes.'
        : `Coleta enfileirada — acionamento imediato indisponível (${cr.reason ?? 'falhou'}); aplica no próximo Inform.`,
    };
  }

  /**
   * Garante que o device tem credenciais de Connection Request. Se faltam,
   * gera, cifra, persiste e enfileira um SET_PARAMS pra gravá-las no CPE
   * (aplica no próximo Inform — por isso `ready=false` na primeira vez).
   */
  private async ensureConnReqCreds(
    tenantId: string,
    device: { id: string; connectionRequestUser: string | null; connectionRequestPwdEnc: string | null },
  ): Promise<{ username: string; password: string; ready: boolean }> {
    if (device.connectionRequestUser && device.connectionRequestPwdEnc) {
      return {
        username: device.connectionRequestUser,
        password: this.crypto.decrypt(device.connectionRequestPwdEnc),
        ready: true,
      };
    }
    const username = `netx-${device.id.slice(0, 8)}`;
    const password = randomBytes(12).toString('hex');
    await this.prisma.tr069Device.update({
      where: { id: device.id },
      data: {
        connectionRequestUser: username,
        connectionRequestPwdEnc: this.crypto.encrypt(password),
      },
    });
    await this.prisma.tr069Task.create({
      data: {
        tenantId,
        deviceId: device.id,
        action: 'SET_PARAMS',
        payload: {
          params: [
            { name: HUAWEI_EG8145_PATHS.connReqUsername, value: username, type: 'xsd:string' },
            { name: HUAWEI_EG8145_PATHS.connReqPassword, value: password, type: 'xsd:string' },
          ],
          purpose: 'CONN_REQ_CREDS',
        },
        status: 'PENDING',
      },
    });
    this.logger.log(`[TR-069] credenciais de connection-request criadas device=${device.id}`);
    return { username, password, ready: false };
  }

  /**
   * Tenta acordar o CPE via Connection Request (ACS→CPE). Devolve uma frase
   * legível do que aconteceu (pra mensagem do refresh/probe). Em rede com NAT é
   * comum não alcançar — cai no Periodic Inform.
   */
  private async tryWake(tenantId: string, deviceId: string): Promise<string> {
    const device = await this.prisma.tr069Device.findFirst({
      where: { id: deviceId, tenantId },
      select: {
        id: true,
        connectionRequestUrl: true,
        connectionRequestUser: true,
        connectionRequestPwdEnc: true,
      },
    });
    if (!device?.connectionRequestUrl) {
      return 'será aplicado no próximo Inform (CPE sem URL de acionamento)';
    }
    const creds = await this.ensureConnReqCreds(tenantId, device);
    if (!creds.ready) {
      return 'credenciais de acionamento sendo aplicadas; o próximo Inform já traz o resultado';
    }
    const cr = await performConnectionRequest(device.connectionRequestUrl, creds.username, creds.password);
    return cr.ok
      ? 'CPE acionado — resultado em instantes'
      : `acionamento imediato indisponível (${cr.reason ?? 'falhou'}); aplica no próximo Inform`;
  }

  // ---------------------------------------------------------------------------
  // Probe de data model (ferramenta de bancada)
  // ---------------------------------------------------------------------------

  /**
   * Enfileira um GetParameterValues com caminhos arbitrários (parciais/completos)
   * pra descobrir os paths reais do firmware Huawei. ⚠️ Huawei dá fault no GET
   * inteiro se UM nome não existir — prove um caminho parcial por vez.
   */
  async enqueueProbe(
    tenantId: string,
    deviceId: string,
    userId: string,
    names: string[],
  ): Promise<{ taskId: string; message: string }> {
    const device = await this.prisma.tr069Device.findFirst({
      where: { id: deviceId, tenantId },
      select: { id: true },
    });
    if (!device) throw new NotFoundException('Device TR-069 não encontrado');
    const task = await this.prisma.tr069Task.create({
      data: {
        tenantId,
        deviceId,
        action: 'GET_PARAMS',
        payload: { names, purpose: 'PROBE' },
        status: 'PENDING',
      },
    });
    await this.audit.log({
      tenantId,
      userId,
      action: 'tr069.device.probe',
      resource: 'tr069_task',
      resourceId: task.id,
      metadata: { deviceId, names },
    });
    const wake = await this.tryWake(tenantId, deviceId);
    return { taskId: task.id, message: `Probe enfileirado — ${wake}.` };
  }

  /** Lê o resultado de uma task de probe (status + params do GET). */
  async getProbeResult(
    tenantId: string,
    deviceId: string,
    taskId: string,
  ): Promise<Tr069ProbeResultDto> {
    const task = await this.prisma.tr069Task.findFirst({
      where: { id: taskId, deviceId, tenantId, action: 'GET_PARAMS' },
      select: {
        id: true,
        status: true,
        error: true,
        payload: true,
        result: true,
        createdAt: true,
        completedAt: true,
      },
    });
    if (!task) throw new NotFoundException('Probe não encontrado');
    const payload = (task.payload ?? {}) as { names?: unknown };
    const names = Array.isArray(payload.names) ? (payload.names as string[]) : [];
    const result = (task.result ?? {}) as { params?: Record<string, unknown> };
    const params = result.params
      ? Object.entries(result.params)
          .map(([name, value]) => ({ name, value: value == null ? '' : String(value) }))
          .sort((a, b) => a.name.localeCompare(b.name))
      : null;
    return {
      taskId: task.id,
      status: task.status,
      error: task.error,
      names,
      params,
      createdAt: task.createdAt.toISOString(),
      completedAt: task.completedAt?.toISOString() ?? null,
    };
  }

  // ---------------------------------------------------------------------------
  // Edição de rádio Wi-Fi (canal/potência/criptografia — SET direto no CPE)
  // ---------------------------------------------------------------------------

  /**
   * Enfileira um SET de tuning de rádio (canal/potência/criptografia). É SET
   * direto no CPE — o reconciliador ignora (não vira regra de profile). SSID e
   * senha continuam vindo do contrato. Aplica no próximo Inform.
   */
  async setWifiRadio(
    tenantId: string,
    deviceId: string,
    userId: string,
    input: SetWifiRadio,
  ): Promise<{ taskId: string; message: string }> {
    const device = await this.prisma.tr069Device.findFirst({
      where: { id: deviceId, tenantId },
      select: { id: true, manufacturer: true },
    });
    if (!device) throw new NotFoundException('Device TR-069 não encontrado');

    // VSOL/Realtek: canal/potência/criptografia via paths padrão TR-098;
    // largura de canal é enum vendor não mapeado (X_CT-COM_ChannelWidth) —
    // rejeita com mensagem clara em vez de dar fault no CPE.
    const vsol = isVsol(device.manufacturer);
    const w = huaweiWlanPaths(input.band);
    const wV = vsolWlanPaths(input.band);
    const params: Array<{ name: string; value: string; type: string }> = [];

    // Canal: auto vs. manual (auto=0 é obrigatório pra fixar o canal).
    // Paths de canal/potência são padrão TR-098 — só muda a origem por vendor
    // (na VSOL os índices de WLAN são invertidos: 1=5G, 5=2.4G) e a lista de
    // canais válidos (PossibleChannels do firmware — 2.4G da VSOL para no 11).
    const chanPaths = vsol ? wV : w;
    const validChannels = vsol ? VSOL_WIFI_CHANNELS[input.band] : HUAWEI_WIFI_CHANNELS[input.band];
    if (input.autoChannel === true) {
      params.push({ name: chanPaths.autoChannel, value: '1', type: 'xsd:boolean' });
    } else if (input.channel !== undefined || input.autoChannel === false) {
      if (input.channel === undefined) {
        throw new BadRequestException('Canal manual exige escolher o canal');
      }
      if (!validChannels.includes(input.channel)) {
        throw new BadRequestException(
          `Canal ${input.channel} inválido para ${input.band} (válidos: ${validChannels.join(', ')})`,
        );
      }
      params.push({ name: chanPaths.autoChannel, value: '0', type: 'xsd:boolean' });
      params.push({ name: chanPaths.channel, value: String(input.channel), type: 'xsd:unsignedInt' });
    }

    // Largura de canal (enum vendor X_HW_HT20 — Huawei apenas).
    if (input.channelWidth !== undefined) {
      if (vsol) {
        throw new BadRequestException(
          'Largura de canal não é ajustável neste modelo (VSOL) — use canal/potência.',
        );
      }
      if (!HUAWEI_WIFI_WIDTHS[input.band].includes(input.channelWidth)) {
        throw new BadRequestException(
          `Largura ${input.channelWidth} não suportada em ${input.band} (válidas: ${HUAWEI_WIFI_WIDTHS[input.band].join(', ')})`,
        );
      }
      params.push({
        name: w.htMode,
        value: HUAWEI_WIFI_WIDTH_CODE[input.channelWidth],
        type: 'xsd:unsignedInt',
      });
    }

    // Potência (%) — TransmitPower é % do máximo em ambos os vendors.
    if (input.txPower !== undefined) {
      if (!HUAWEI_TX_POWER_LEVELS.includes(input.txPower as (typeof HUAWEI_TX_POWER_LEVELS)[number])) {
        throw new BadRequestException(
          `Potência ${input.txPower} inválida (válidas: ${HUAWEI_TX_POWER_LEVELS.join(', ')})`,
        );
      }
      params.push({ name: chanPaths.txPower, value: String(input.txPower), type: 'xsd:unsignedInt' });
    }

    // Criptografia (nunca abre a rede — só WPA2 ou WPA/WPA2).
    if (input.security) {
      params.push(
        ...(vsol
          ? vsolWlanSecurityParams(input.band, input.security)
          : huaweiWlanSecurityParams(input.band, input.security)),
      );
    }

    if (params.length === 0) {
      throw new BadRequestException('Nenhuma alteração informada');
    }

    const task = await this.prisma.tr069Task.create({
      data: {
        tenantId,
        deviceId,
        action: 'SET_PARAMS',
        payload: { params, purpose: 'WIFI_RADIO', band: input.band },
        status: 'PENDING',
      },
    });
    await this.audit.log({
      tenantId,
      userId,
      action: 'tr069.device.wifi.set',
      resource: 'tr069_task',
      resourceId: task.id,
      metadata: {
        deviceId,
        band: input.band,
        autoChannel: input.autoChannel ?? null,
        channel: input.channel ?? null,
        channelWidth: input.channelWidth ?? null,
        txPower: input.txPower ?? null,
        security: input.security ?? null,
      },
    });
    const wake = await this.tryWake(tenantId, deviceId);
    return { taskId: task.id, message: `Configuração de Wi-Fi (${input.band}) enfileirada — ${wake}.` };
  }

  // ---------------------------------------------------------------------------
  // Toggles do roteador (TimeZone + BandSteering — SET direto no CPE)
  // ---------------------------------------------------------------------------

  /**
   * Enfileira um SET dos toggles de roteador (fuso/NTP + band steering). SET
   * direto no CPE; o reconciliador ignora. UPnP/EasyMesh não são expostos via
   * TR-069 nesse firmware, então ficam de fora.
   */
  async setRouterSettings(
    tenantId: string,
    deviceId: string,
    userId: string,
    input: SetRouterSettings,
  ): Promise<{ taskId: string; message: string }> {
    const device = await this.prisma.tr069Device.findFirst({
      where: { id: deviceId, tenantId },
      select: { id: true, manufacturer: true },
    });
    if (!device) throw new NotFoundException('Device TR-069 não encontrado');

    // Time.* é padrão TR-098 (vale pra todos); BandSteering é X_HW_ (Huawei).
    if (input.bandSteering !== undefined && isVsol(device.manufacturer)) {
      throw new BadRequestException('Band steering não é exposto via TR-069 neste modelo (VSOL).');
    }

    const params: Array<{ name: string; value: string; type: string }> = [];
    if (input.timeEnable !== undefined) {
      params.push({
        name: HUAWEI_ROUTER_PATHS.timeEnable,
        value: input.timeEnable ? '1' : '0',
        type: 'xsd:boolean',
      });
    }
    if (input.timeZoneOffset !== undefined) {
      params.push({ name: HUAWEI_ROUTER_PATHS.timeZoneOffset, value: input.timeZoneOffset, type: 'xsd:string' });
    }
    if (input.timeZoneName !== undefined) {
      params.push({ name: HUAWEI_ROUTER_PATHS.timeZoneName, value: input.timeZoneName, type: 'xsd:string' });
    }
    if (input.ntpServer !== undefined) {
      params.push({ name: HUAWEI_ROUTER_PATHS.ntpServer1, value: input.ntpServer, type: 'xsd:string' });
    }
    if (input.bandSteering !== undefined) {
      params.push({
        name: HUAWEI_ROUTER_PATHS.bandSteeringPolicy,
        value: input.bandSteering ? '1' : '0',
        type: 'xsd:unsignedInt',
      });
    }

    if (params.length === 0) {
      throw new BadRequestException('Nenhuma alteração informada');
    }

    const task = await this.prisma.tr069Task.create({
      data: {
        tenantId,
        deviceId,
        action: 'SET_PARAMS',
        payload: { params, purpose: 'ROUTER_SETTINGS' },
        status: 'PENDING',
      },
    });
    await this.audit.log({
      tenantId,
      userId,
      action: 'tr069.device.router.set',
      resource: 'tr069_task',
      resourceId: task.id,
      metadata: {
        deviceId,
        timeEnable: input.timeEnable ?? null,
        timeZoneOffset: input.timeZoneOffset ?? null,
        timeZoneName: input.timeZoneName ?? null,
        ntpServer: input.ntpServer ?? null,
        bandSteering: input.bandSteering ?? null,
      },
    });
    const wake = await this.tryWake(tenantId, deviceId);
    return { taskId: task.id, message: `Configuração do roteador enfileirada — ${wake}.` };
  }

  // ---------------------------------------------------------------------------
  // Scan de vizinhança Wi-Fi (heatmap de ocupação de canais 2.4G)
  // ---------------------------------------------------------------------------

  /** Dispara o scan (DiagnosticsState=Requested) + enfileira a leitura. */
  async requestWifiScan(
    tenantId: string,
    deviceId: string,
    userId: string,
  ): Promise<{ message: string }> {
    const device = await this.prisma.tr069Device.findFirst({
      where: { id: deviceId, tenantId },
      select: { id: true, manufacturer: true },
    });
    if (!device) throw new NotFoundException('Device TR-069 não encontrado');
    // NeighboringWiFiDiagnostic não existe no data model VSOL/Realtek —
    // rejeita com mensagem clara em vez de enfileirar SET que vai dar fault.
    if (isVsol(device.manufacturer)) {
      throw new BadRequestException('Scan de canais não é exposto via TR-069 neste modelo (VSOL).');
    }
    await this.prisma.tr069Task.create({
      data: {
        tenantId,
        deviceId,
        action: 'SET_PARAMS',
        payload: {
          params: [{ name: HUAWEI_WIFI_SCAN.state, value: 'Requested', type: 'xsd:string' }],
          purpose: 'WIFI_SCAN_TRIGGER',
        },
        status: 'PENDING',
      },
    });
    await this.enqueueWifiScanRead(tenantId, deviceId);
    await this.audit.log({
      tenantId,
      userId,
      action: 'tr069.device.wifi.scan',
      resource: 'tr069_device',
      resourceId: deviceId,
    });
    const wake = await this.tryWake(tenantId, deviceId);
    return { message: `Scan de canais disparado — ${wake}.` };
  }

  /** Enfileira a leitura da subárvore do scan, se não houver uma em voo. */
  private async enqueueWifiScanRead(tenantId: string, deviceId: string): Promise<void> {
    const inflight = await this.prisma.tr069Task.findFirst({
      where: {
        tenantId,
        deviceId,
        action: 'GET_PARAMS',
        status: { in: ['PENDING', 'RUNNING'] },
        payload: { path: ['purpose'], equals: 'WIFI_SCAN' },
      },
      select: { id: true },
    });
    if (inflight) return;
    await this.prisma.tr069Task.create({
      data: {
        tenantId,
        deviceId,
        action: 'GET_PARAMS',
        payload: { names: [HUAWEI_WIFI_SCAN.subtree], purpose: 'WIFI_SCAN' },
        status: 'PENDING',
      },
    });
  }

  /**
   * Resultado do scan: parseia a subárvore Result.{i} da última leitura DONE e
   * agrega a ocupação por canal 2.4G. Mantém uma leitura em voo pra atualizar.
   */
  async getWifiScan(tenantId: string, deviceId: string): Promise<Tr069WifiScanResponse> {
    const device = await this.prisma.tr069Device.findFirst({
      where: { id: deviceId, tenantId },
      select: { id: true },
    });
    if (!device) throw new NotFoundException('Device TR-069 não encontrado');

    const [done, pendingTask] = await Promise.all([
      this.prisma.tr069Task.findFirst({
        where: {
          tenantId,
          deviceId,
          action: 'GET_PARAMS',
          status: 'DONE',
          payload: { path: ['purpose'], equals: 'WIFI_SCAN' },
        },
        orderBy: { completedAt: 'desc' },
        select: { result: true, completedAt: true },
      }),
      this.prisma.tr069Task.findFirst({
        where: {
          tenantId,
          deviceId,
          action: 'GET_PARAMS',
          status: { in: ['PENDING', 'RUNNING'] },
          payload: { path: ['purpose'], equals: 'WIFI_SCAN' },
        },
        select: { id: true },
      }),
    ]);

    const params = ((done?.result ?? {}) as { params?: Record<string, unknown> }).params ?? {};
    const neighbors = parseWifiNeighbors(params as Record<string, unknown>);
    const state = (params[HUAWEI_WIFI_SCAN.state] as string | undefined) ?? null;

    // Ocupação por canal 2.4G (1–13).
    const counts = new Map<number, number>();
    for (const n of neighbors) {
      if (n.band !== '2.4GHz' || n.channel === null || n.channel < 1 || n.channel > 13) continue;
      counts.set(n.channel, (counts.get(n.channel) ?? 0) + 1);
    }
    const channels24 = Array.from({ length: 13 }, (_, i) => ({
      channel: i + 1,
      count: counts.get(i + 1) ?? 0,
    }));

    return {
      state,
      scannedAt: done?.completedAt?.toISOString() ?? null,
      pending: !!pendingTask,
      neighbors,
      channels24,
    };
  }

  // ---------------------------------------------------------------------------
  // TR-143 — speed test / ping a pedido
  // ---------------------------------------------------------------------------

  /** Dispara um speed test (DownloadDiagnostics). Resultado chega async. */
  async requestSpeedTest(
    tenantId: string,
    deviceId: string,
    userId: string,
    url?: string,
  ): Promise<{ runId: string; message: string }> {
    const device = await this.prisma.tr069Device.findFirst({
      where: { id: deviceId, tenantId },
      select: { id: true },
    });
    if (!device) throw new NotFoundException('Device TR-069 não encontrado');
    const target = url ?? process.env.TR069_SPEEDTEST_URL;
    if (!target) {
      throw new BadRequestException('Defina TR069_SPEEDTEST_URL (arquivo de teste) ou informe a URL.');
    }
    const run = await this.prisma.tr069DiagnosticRun.create({
      data: { tenantId, deviceId, kind: 'DOWNLOAD', target, requestedBy: userId },
    });
    await this.prisma.tr069Task.create({
      data: {
        tenantId,
        deviceId,
        action: 'SET_PARAMS',
        payload: {
          params: [
            { name: TR143_DOWNLOAD.url, value: target, type: 'xsd:string' },
            { name: TR143_DOWNLOAD.state, value: 'Requested', type: 'xsd:string' },
          ],
          purpose: 'TR143_DOWNLOAD',
        },
        status: 'PENDING',
      },
    });

    // Upload (opcional): só dispara se houver um sink HTTP configurado.
    const uploadUrl = process.env.TR069_SPEEDTEST_UPLOAD_URL;
    let withUpload = false;
    if (uploadUrl) {
      const bytes = process.env.TR069_SPEEDTEST_UPLOAD_BYTES ?? '50000000';
      await this.prisma.tr069DiagnosticRun.create({
        data: { tenantId, deviceId, kind: 'UPLOAD', target: uploadUrl, requestedBy: userId },
      });
      await this.prisma.tr069Task.create({
        data: {
          tenantId,
          deviceId,
          action: 'SET_PARAMS',
          payload: {
            params: [
              { name: TR143_UPLOAD.url, value: uploadUrl, type: 'xsd:string' },
              { name: TR143_UPLOAD.testFileLength, value: bytes, type: 'xsd:unsignedInt' },
              { name: TR143_UPLOAD.state, value: 'Requested', type: 'xsd:string' },
            ],
            purpose: 'TR143_UPLOAD',
          },
          status: 'PENDING',
        },
      });
      withUpload = true;
    }
    return {
      runId: run.id,
      message: withUpload
        ? 'Speed test (download + upload) disparado — resultado em alguns segundos.'
        : 'Speed test (download) disparado — resultado em alguns segundos.',
    };
  }

  /** Dispara um ping (IPPingDiagnostics) pra um host. Resultado async. */
  async requestPing(
    tenantId: string,
    deviceId: string,
    userId: string,
    host: string,
  ): Promise<{ runId: string; message: string }> {
    const device = await this.prisma.tr069Device.findFirst({
      where: { id: deviceId, tenantId },
      select: { id: true },
    });
    if (!device) throw new NotFoundException('Device TR-069 não encontrado');
    const run = await this.prisma.tr069DiagnosticRun.create({
      data: { tenantId, deviceId, kind: 'PING', target: host, requestedBy: userId },
    });
    await this.prisma.tr069Task.create({
      data: {
        tenantId,
        deviceId,
        action: 'SET_PARAMS',
        payload: {
          params: [
            { name: TR143_PING.host, value: host, type: 'xsd:string' },
            { name: TR143_PING.reps, value: '4', type: 'xsd:unsignedInt' },
            { name: TR143_PING.state, value: 'Requested', type: 'xsd:string' },
          ],
          purpose: 'TR143_PING',
        },
        status: 'PENDING',
      },
    });
    return { runId: run.id, message: 'Ping disparado — resultado em alguns segundos.' };
  }

  /** Lista as runs de diagnóstico (speed test / ping) recentes do device. */
  async listDiagRuns(tenantId: string, deviceId: string): Promise<Tr069DiagRunDto[]> {
    const rows = await this.prisma.tr069DiagnosticRun.findMany({
      where: { tenantId, deviceId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      state: r.state,
      target: r.target,
      throughputKbps: r.throughputKbps,
      pingSuccess: r.pingSuccess,
      pingFailure: r.pingFailure,
      pingAvgMs: dec(r.pingAvgMs),
      pingMinMs: dec(r.pingMinMs),
      pingMaxMs: dec(r.pingMaxMs),
      errorText: r.errorText,
      createdAt: r.createdAt.toISOString(),
      completedAt: r.completedAt?.toISOString() ?? null,
    }));
  }

  // ---------------------------------------------------------------------------
  // Leitura pra UI
  // ---------------------------------------------------------------------------

  /**
   * Dashboard "Fila de diagnóstico" (landing /tr069): KPIs + fila de CPEs com
   * alerta aberto (1 linha por device, pior severidade) + breakdown de sintomas.
   */
  async getDashboard(tenantId: string): Promise<Tr069DashboardResponse> {
    const [statusCounts, complianceCounts, alerts, symptomGroups, oltDevices] = await Promise.all([
      this.prisma.tr069Device.groupBy({ by: ['status'], where: { tenantId }, _count: { _all: true } }),
      this.prisma.tr069Device.groupBy({
        by: ['complianceStatus'],
        where: { tenantId },
        _count: { _all: true },
      }),
      this.prisma.tr069Alert.findMany({
        where: { tenantId, status: 'OPEN' },
        orderBy: [{ severity: 'desc' }, { lastSeenAt: 'desc' }],
        take: 100,
        include: {
          device: {
            select: {
              id: true,
              deviceId: true,
              productClass: true,
              lastInformAt: true,
              ont: {
                select: { contract: { select: { customer: { select: { displayName: true } } } } },
              },
            },
          },
        },
      }),
      this.prisma.tr069Alert.groupBy({
        by: ['type'],
        where: { tenantId, status: 'OPEN' },
        _count: { _all: true },
      }),
      // Devices com OLT (via ONT) — base do "Mapa OLT".
      this.prisma.tr069Device.findMany({
        where: { tenantId, ont: { isNot: null } },
        select: {
          id: true,
          status: true,
          ont: { select: { olt: { select: { id: true, name: true } } } },
        },
      }),
    ]);

    const byStatus = (s: string) => statusCounts.find((x) => x.status === s)?._count._all ?? 0;
    const naoConformes = complianceCounts
      .filter((c) => ['DRIFTED', 'REMEDIATING', 'PENDING_REBOOT', 'FAILED'].includes(c.complianceStatus))
      .reduce((sum, c) => sum + c._count._all, 0);
    const sevMap = (s: string): 'ok' | 'warn' | 'crit' =>
      s === 'CRITICAL' ? 'crit' : s === 'WARNING' ? 'warn' : 'ok';

    // Devices (todos) com alerta aberto — base do "degradado" no Mapa OLT.
    const alertedDeviceIds = new Set(
      (
        await this.prisma.tr069Alert.findMany({
          where: { tenantId, status: 'OPEN' },
          select: { deviceId: true },
          distinct: ['deviceId'],
        })
      ).map((a) => a.deviceId),
    );

    // Agrega saúde por OLT: total de CPEs e quantos degradados (offline ou com alerta).
    const oltMap = new Map<string, { oltId: string; oltName: string; total: number; degraded: number }>();
    for (const dev of oltDevices) {
      const olt = dev.ont?.olt;
      if (!olt) continue;
      let cell = oltMap.get(olt.id);
      if (!cell) {
        cell = { oltId: olt.id, oltName: olt.name, total: 0, degraded: 0 };
        oltMap.set(olt.id, cell);
      }
      cell.total += 1;
      if (dev.status === 'OFFLINE' || alertedDeviceIds.has(dev.id)) cell.degraded += 1;
    }
    const olts = Array.from(oltMap.values()).sort((a, b) => a.oltName.localeCompare(b.oltName));

    // 1 linha por device — a 1ª (ordenada por severidade desc) é a pior.
    const seen = new Set<string>();
    const queue: Tr069DashboardResponse['queue'] = [];
    for (const a of alerts) {
      if (seen.has(a.deviceId)) continue;
      seen.add(a.deviceId);
      queue.push({
        deviceId: a.device.id,
        label: a.device.ont?.contract?.customer?.displayName ?? a.device.deviceId,
        model: a.device.productClass,
        severity: sevMap(a.severity),
        symptom: a.message,
        type: a.type,
        signal: a.value === null ? null : Number(a.value),
        lastInformAt: a.device.lastInformAt?.toISOString() ?? null,
      });
    }

    return {
      kpis: {
        online: byStatus('ONLINE'),
        offline: byStatus('OFFLINE'),
        alerta: seen.size,
        naoConformes,
      },
      queue,
      symptoms: symptomGroups
        .map((g) => ({ type: g.type, count: g._count._all }))
        .sort((x, y) => y.count - x.count),
      olts,
    };
  }

  async getDeviceDetail(tenantId: string, deviceId: string): Promise<Tr069DeviceDetailResponse> {
    const device = await this.prisma.tr069Device.findFirst({
      where: { id: deviceId, tenantId },
      include: {
        ont: {
          select: {
            id: true,
            snGpon: true,
            macAddress: true,
            contractId: true,
            status: true,
            lastRxPower: true,
            lastTxPower: true,
            contract: {
              select: {
                id: true,
                code: true,
                status: true,
                pppoeUsername: true,
                customer: { select: { id: true, displayName: true, status: true } },
              },
            },
          },
        },
        diagnostics: { orderBy: { capturedAt: 'desc' }, take: 1 },
        alerts: {
          where: { status: 'OPEN' },
          orderBy: [{ severity: 'desc' }, { openedAt: 'desc' }],
        },
        tasks: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });
    if (!device) throw new NotFoundException('Device TR-069 não encontrado');

    const latest = device.diagnostics[0] ?? null;

    return {
      id: device.id,
      deviceId: device.deviceId,
      manufacturer: device.manufacturer,
      oui: device.oui,
      productClass: device.productClass,
      hardwareVersion: device.hardwareVersion,
      softwareVersion: device.softwareVersion,
      status: device.status,
      lastInformAt: device.lastInformAt?.toISOString() ?? null,
      lastInformReason: device.lastInformReason,
      lastDiagnosticAt: device.lastDiagnosticAt?.toISOString() ?? null,
      connectionRequestUrl: device.connectionRequestUrl,
      ont: device.ont
        ? {
            id: device.ont.id,
            snGpon: device.ont.snGpon,
            macAddress: device.ont.macAddress,
            contractId: device.ont.contractId,
            status: device.ont.status,
            lastRxPower: device.ont.lastRxPower === null ? null : String(device.ont.lastRxPower),
            lastTxPower: device.ont.lastTxPower === null ? null : String(device.ont.lastTxPower),
          }
        : null,
      customer: device.ont?.contract
        ? {
            customerId: device.ont.contract.customer.id,
            customerName: device.ont.contract.customer.displayName,
            customerStatus: device.ont.contract.customer.status,
            contractId: device.ont.contract.id,
            contractCode: device.ont.contract.code,
            contractStatus: device.ont.contract.status,
            pppoeUsername: device.ont.contract.pppoeUsername,
          }
        : null,
      latest: latest ? this.toDiagnosticDto(latest) : null,
      openAlerts: device.alerts.map((a) => this.toAlertDto(a)),
      recentTasks: device.tasks.map((t) => this.toTaskDto(t)),
    };
  }

  /**
   * Lista plana de todos os parâmetros do último snapshot (Inform/GET) — pro
   * visor de atributos TR-069 no portal (busca/paginação no front).
   */
  async listDeviceParameters(
    tenantId: string,
    deviceId: string,
  ): Promise<Array<{ name: string; value: string }>> {
    const device = await this.prisma.tr069Device.findFirst({
      where: { id: deviceId, tenantId },
      select: { parametersSnapshot: true },
    });
    if (!device) throw new NotFoundException('Device TR-069 não encontrado');
    const snap = (device.parametersSnapshot ?? {}) as Record<string, unknown>;
    return Object.entries(snap)
      .map(([name, value]) => ({ name, value: value == null ? '' : String(value) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  // ---------------------------------------------------------------------------
  // Notas do device (anotações livres do atendimento N1)
  // ---------------------------------------------------------------------------

  /** Lista as notas (não apagadas) de um device, mais recentes primeiro. */
  async listNotes(tenantId: string, deviceId: string): Promise<Tr069DeviceNoteDto[]> {
    const device = await this.prisma.tr069Device.findFirst({
      where: { id: deviceId, tenantId },
      select: { id: true },
    });
    if (!device) throw new NotFoundException('Device TR-069 não encontrado');
    const rows = await this.prisma.tr069DeviceNote.findMany({
      where: { tenantId, deviceId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map((n) => this.toNoteDto(n));
  }

  /** Cria uma nota livre no device. */
  async createNote(
    tenantId: string,
    deviceId: string,
    user: { sub: string; email: string },
    body: string,
  ): Promise<Tr069DeviceNoteDto> {
    const device = await this.prisma.tr069Device.findFirst({
      where: { id: deviceId, tenantId },
      select: { id: true },
    });
    if (!device) throw new NotFoundException('Device TR-069 não encontrado');
    const note = await this.prisma.tr069DeviceNote.create({
      data: {
        tenantId,
        deviceId,
        body,
        createdById: user.sub,
        createdByEmail: user.email,
      },
    });
    await this.audit.log({
      tenantId,
      userId: user.sub,
      action: 'tr069.device.note.create',
      resource: 'tr069_device_note',
      resourceId: note.id,
      metadata: { deviceId },
    });
    return this.toNoteDto(note);
  }

  /** Soft-delete de uma nota. */
  async deleteNote(tenantId: string, deviceId: string, noteId: string, userId: string): Promise<void> {
    const note = await this.prisma.tr069DeviceNote.findFirst({
      where: { id: noteId, deviceId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!note) throw new NotFoundException('Nota não encontrada');
    await this.prisma.tr069DeviceNote.update({
      where: { id: note.id },
      data: { deletedAt: new Date() },
    });
    await this.audit.log({
      tenantId,
      userId,
      action: 'tr069.device.note.delete',
      resource: 'tr069_device_note',
      resourceId: note.id,
      metadata: { deviceId },
    });
  }

  private toNoteDto(n: {
    id: string;
    body: string;
    createdById: string | null;
    createdByEmail: string | null;
    createdAt: Date;
  }): Tr069DeviceNoteDto {
    return {
      id: n.id,
      body: n.body,
      createdById: n.createdById,
      createdByEmail: n.createdByEmail,
      createdAt: n.createdAt.toISOString(),
    };
  }

  // ---------------------------------------------------------------------------
  // Histórico do device (aba Histórico — derivado de tasks + alertas)
  // ---------------------------------------------------------------------------

  /**
   * Histórico do device sem coletor novo: reboots/quedas por dia (14d),
   * disponibilidade (30d, derivada dos alertas DEVICE_OFFLINE) e linha do tempo
   * de eventos (alertas + tasks). Tudo a partir de dados que já temos.
   */
  async getDeviceHistory(
    tenantId: string,
    deviceId: string,
  ): Promise<Tr069DeviceHistoryResponse> {
    const device = await this.prisma.tr069Device.findFirst({
      where: { id: deviceId, tenantId },
      select: { id: true },
    });
    if (!device) throw new NotFoundException('Device TR-069 não encontrado');

    const DAY_MS = 24 * 60 * 60_000;
    const now = Date.now();
    const startOfToday = new Date(new Date(now).setHours(0, 0, 0, 0)).getTime();

    const DAILY_DAYS = 14;
    const AVAIL_DAYS = 30;
    const dailyStart = startOfToday - (DAILY_DAYS - 1) * DAY_MS;
    const availStart = startOfToday - (AVAIL_DAYS - 1) * DAY_MS;

    const [rebootTasks, offlineAlerts, recentAlerts, recentTasks] = await Promise.all([
      this.prisma.tr069Task.findMany({
        where: { tenantId, deviceId, action: 'REBOOT', createdAt: { gte: new Date(dailyStart) } },
        select: { createdAt: true },
      }),
      // Alertas de queda que tocam a janela de 30d (abertos no período OU ainda
      // não resolvidos) — pra colorir disponibilidade e contar quedas no daily.
      this.prisma.tr069Alert.findMany({
        where: {
          tenantId,
          deviceId,
          type: 'DEVICE_OFFLINE',
          OR: [{ resolvedAt: null }, { resolvedAt: { gte: new Date(availStart) } }],
        },
        select: { openedAt: true, resolvedAt: true, lastSeenAt: true },
      }),
      this.prisma.tr069Alert.findMany({
        where: { tenantId, deviceId },
        orderBy: { openedAt: 'desc' },
        take: 25,
        select: { type: true, severity: true, status: true, message: true, openedAt: true, resolvedAt: true },
      }),
      this.prisma.tr069Task.findMany({
        where: { tenantId, deviceId },
        orderBy: { createdAt: 'desc' },
        take: 25,
        select: { action: true, status: true, error: true, createdAt: true },
      }),
    ]);

    // ── Daily (14d): reboots + quedas por dia ─────────────────────────────────
    const dayIndex = (t: number, start: number) => Math.floor((t - start) / DAY_MS);
    const reboots = new Array<number>(DAILY_DAYS).fill(0);
    const outages = new Array<number>(DAILY_DAYS).fill(0);
    for (const r of rebootTasks) {
      const i = dayIndex(r.createdAt.getTime(), dailyStart);
      if (i >= 0 && i < DAILY_DAYS) reboots[i] += 1;
    }
    for (const a of offlineAlerts) {
      const i = dayIndex(a.openedAt.getTime(), dailyStart);
      if (i >= 0 && i < DAILY_DAYS) outages[i] += 1;
    }
    const daily = Array.from({ length: DAILY_DAYS }, (_, i) => ({
      date: new Date(dailyStart + i * DAY_MS).toISOString(),
      reboots: reboots[i],
      outages: outages[i],
    }));

    // ── Disponibilidade (30d): dia é 'crit' se houve queda sobrepondo o dia ────
    const availability: Array<'ok' | 'warn' | 'crit'> = [];
    let okDays = 0;
    for (let i = 0; i < AVAIL_DAYS; i++) {
      const dayStart = availStart + i * DAY_MS;
      const dayEnd = dayStart + DAY_MS;
      const down = offlineAlerts.some((a) => {
        const s = a.openedAt.getTime();
        const e = (a.resolvedAt ?? a.lastSeenAt ?? new Date(now)).getTime();
        return s < dayEnd && e >= dayStart;
      });
      availability.push(down ? 'crit' : 'ok');
      if (!down) okDays += 1;
    }
    const availabilityPct = Math.round((okDays / AVAIL_DAYS) * 1000) / 10;

    // ── Timeline: alertas + tasks, mais recentes primeiro ─────────────────────
    const sevFromAlert = (s: string): 'ok' | 'warn' | 'crit' | 'info' =>
      s === 'CRITICAL' ? 'crit' : s === 'WARNING' ? 'warn' : 'info';
    const sevFromTask = (s: string): 'ok' | 'warn' | 'crit' | 'info' =>
      s === 'FAILED' ? 'crit' : s === 'DONE' ? 'ok' : 'info';

    const alertEvents = recentAlerts.map((a) => ({
      at: a.openedAt.toISOString(),
      severity: sevFromAlert(a.severity),
      title: a.status === 'RESOLVED' ? `Alerta resolvido · ${a.type}` : `Alerta · ${a.type}`,
      description: a.message,
    }));
    const taskEvents = recentTasks.map((t) => ({
      at: t.createdAt.toISOString(),
      severity: sevFromTask(t.status),
      title: `${t.action} · ${t.status}`,
      description: t.error,
    }));
    const timeline = [...alertEvents, ...taskEvents]
      .sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0))
      .slice(0, 30);

    return { daily, availability, availabilityPct, timeline };
  }

  /**
   * Resolve o device TR-069 de um contrato (via ONT) e devolve o detalhe.
   * Null quando o contrato não tem CPE gerenciada — o card no contrato some.
   * Usado pelo "Hub do Atendente" (painel de diagnóstico dentro do contrato).
   */
  async getDeviceByContract(
    tenantId: string,
    contractId: string,
  ): Promise<Tr069DeviceDetailResponse | null> {
    const device = await this.prisma.tr069Device.findFirst({
      where: { tenantId, ont: { contractId } },
      select: { id: true },
    });
    if (!device) return null;
    return this.getDeviceDetail(tenantId, device.id);
  }

  async listDiagnostics(
    tenantId: string,
    deviceId: string,
    limit: number,
  ): Promise<Tr069DiagnosticDto[]> {
    const device = await this.prisma.tr069Device.findFirst({
      where: { id: deviceId, tenantId },
      select: { id: true },
    });
    if (!device) throw new NotFoundException('Device TR-069 não encontrado');
    const rows = await this.prisma.tr069Diagnostic.findMany({
      where: { tenantId, deviceId },
      orderBy: { capturedAt: 'desc' },
      take: limit,
    });
    return rows.map((r) => this.toDiagnosticDto(r));
  }

  /**
   * Ranking de cobertura Wi-Fi: ONTs com RSSI médio dos clientes pior (mais
   * alto = mais negativo) na janela. Base pra atendimento proativo / venda de
   * mesh. Agrega a série denormalizada (wifiAvgRssi) e junta cliente/contrato.
   */
  async getWifiCoverage(
    tenantId: string,
    query: ListWifiCoverageQuery,
  ): Promise<Paginated<WifiCoverageRow>> {
    const cutoff = new Date(Date.now() - query.days * 24 * 60 * 60_000);
    const grouped = await this.prisma.tr069Diagnostic.groupBy({
      by: ['deviceId'],
      where: { tenantId, capturedAt: { gt: cutoff }, wifiAvgRssi: { not: null } },
      _avg: { wifiAvgRssi: true },
      _min: { wifiWorstRssi: true },
      _count: { _all: true },
      _max: { capturedAt: true },
    });

    // Filtra por amostras mínimas + limiar de RSSI ruim, ordena do pior pro melhor.
    const filtered = grouped
      .map((g) => ({
        deviceId: g.deviceId,
        avgRssi: g._avg.wifiAvgRssi === null ? null : Math.round(g._avg.wifiAvgRssi),
        worstRssi: g._min.wifiWorstRssi,
        samples: g._count._all,
        lastSeenAt: g._max.capturedAt,
      }))
      .filter((g) => g.samples >= query.minSamples && g.avgRssi !== null && g.avgRssi <= query.maxRssi)
      .sort((a, b) => (a.avgRssi ?? 0) - (b.avgRssi ?? 0));

    const total = filtered.length;
    const pageRows = filtered.slice((query.page - 1) * query.pageSize, query.page * query.pageSize);

    // Enriquece com device → ONT → contrato → cliente.
    const devices = await this.prisma.tr069Device.findMany({
      where: { id: { in: pageRows.map((r) => r.deviceId) } },
      select: {
        id: true,
        deviceId: true,
        ont: {
          select: {
            snGpon: true,
            contract: { select: { id: true, code: true, customer: { select: { id: true, displayName: true } } } },
          },
        },
      },
    });
    const byId = new Map(devices.map((d) => [d.id, d]));

    const data: WifiCoverageRow[] = pageRows.map((r) => {
      const dev = byId.get(r.deviceId);
      const contract = dev?.ont?.contract ?? null;
      return {
        deviceId: r.deviceId,
        deviceLabel: dev?.deviceId ?? r.deviceId,
        ontSnGpon: dev?.ont?.snGpon ?? null,
        contractId: contract?.id ?? null,
        contractCode: contract?.code ?? null,
        customerId: contract?.customer?.id ?? null,
        customerName: contract?.customer?.displayName ?? null,
        avgRssi: r.avgRssi,
        worstRssi: r.worstRssi,
        samples: r.samples,
        lastSeenAt: r.lastSeenAt?.toISOString() ?? null,
      };
    });

    return { data, pagination: paginationMeta(total, query.page, query.pageSize) };
  }

  async listAlerts(
    tenantId: string,
    query: ListTr069AlertsQuery,
  ): Promise<Paginated<Tr069AlertDto>> {
    const where: Prisma.Tr069AlertWhereInput = {
      tenantId,
      ...(query.status && { status: query.status }),
      ...(query.severity && { severity: query.severity }),
      ...(query.deviceId && { deviceId: query.deviceId }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.tr069Alert.findMany({
        where,
        orderBy: [{ status: 'asc' }, { severity: 'desc' }, { openedAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { device: { select: { id: true, deviceId: true, ont: { select: { snGpon: true } } } } },
      }),
      this.prisma.tr069Alert.count({ where }),
    ]);
    return {
      data: rows.map((a) => ({
        ...this.toAlertDto(a),
        device: { id: a.device.id, deviceId: a.device.deviceId, ontSnGpon: a.device.ont?.snGpon ?? null },
      })),
      pagination: paginationMeta(total, query.page, query.pageSize),
    };
  }

  // ---------------------------------------------------------------------------
  // Crons
  // ---------------------------------------------------------------------------

  /**
   * Arma notificações nos devices ONLINE ainda não armados (uma vez por device).
   * Depois disso os níveis ópticos passam a chegar no Inform periódico.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async armNotifications(): Promise<void> {
    if (!this.enabled) return;
    const unarmed = await this.prisma.tr069Device.findMany({
      where: { status: 'ONLINE', notificationsArmedAt: null },
      select: { id: true, tenantId: true },
      take: CRON_BATCH,
    });
    let armed = 0;
    for (const d of unarmed) {
      try {
        await this.enqueueArmNotifications(d.tenantId, d.id);
        armed += 1;
      } catch (err) {
        this.logger.error(`[TR-069] arme de notificações falhou device=${d.id}: ${String(err)}`);
      }
    }
    if (armed > 0) this.logger.log(`[TR-069] notificações armadas em ${armed} device(s)`);
  }

  /** Retenção: apaga diagnósticos antigos (a série cresce a cada Inform). */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async pruneOldDiagnostics(): Promise<void> {
    if (RETENTION_DAYS <= 0) return;
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60_000);
    const res = await this.prisma.tr069Diagnostic.deleteMany({
      where: { capturedAt: { lt: cutoff } },
    });
    if (res.count > 0) {
      this.logger.log(`[TR-069] retenção: ${res.count} diagnóstico(s) > ${RETENTION_DAYS}d removidos`);
    }
  }

  /**
   * Relaxa o PeriodicInformInterval: o ZTP seta rápido (60s) pra ativação; após
   * INFORM_RELAX_AFTER_MIN (default 2h) sobe pro intervalo permanente (default
   * 5min). Mantém a conformidade quase em tempo real sem depender de CR — as
   * notificações ativas (GPON Status) ainda disparam Inform na hora se algo cair.
   * Roda 1× por device (flag informIntervalRelaxedAt).
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async relaxInformInterval(): Promise<void> {
    if (!this.enabled || INFORM_RELAXED_INTERVAL <= 0) return;
    const cutoff = new Date(Date.now() - INFORM_RELAX_AFTER_MIN * 60_000);
    const due = await this.prisma.tr069Device.findMany({
      where: {
        status: 'ONLINE',
        notificationsArmedAt: { not: null, lt: cutoff },
        informIntervalRelaxedAt: null,
      },
      select: { id: true, tenantId: true },
      take: CRON_BATCH,
    });
    let relaxed = 0;
    for (const d of due) {
      try {
        await this.prisma.tr069Task.create({
          data: {
            tenantId: d.tenantId,
            deviceId: d.id,
            action: 'SET_PARAMS',
            payload: {
              params: [
                {
                  name: HUAWEI_EG8145_PATHS.informInterval,
                  value: String(INFORM_RELAXED_INTERVAL),
                  type: 'xsd:unsignedInt',
                },
              ],
              purpose: 'INFORM_RELAX',
            },
            status: 'PENDING',
          },
        });
        await this.prisma.tr069Device.update({
          where: { id: d.id },
          data: { informIntervalRelaxedAt: new Date() },
        });
        relaxed += 1;
      } catch (err) {
        this.logger.error(`[TR-069] relaxar inform falhou device=${d.id}: ${String(err)}`);
      }
    }
    if (relaxed > 0) {
      this.logger.log(`[TR-069] inform interval relaxado p/ ${INFORM_RELAXED_INTERVAL}s em ${relaxed} device(s)`);
    }
  }

  /** Coleta proativa — enfileira diagnóstico pros devices ONLINE com leitura velha. */
  @Cron(CronExpression.EVERY_MINUTE)
  async collectProactively(): Promise<void> {
    if (!this.enabled) return;
    const cutoff = new Date(Date.now() - DIAGNOSTIC_INTERVAL_MIN * 60_000);
    const due = await this.prisma.tr069Device.findMany({
      where: {
        status: 'ONLINE',
        OR: [{ lastDiagnosticAt: null }, { lastDiagnosticAt: { lt: cutoff } }],
      },
      select: { id: true, tenantId: true },
      take: CRON_BATCH,
    });
    let enqueued = 0;
    for (const d of due) {
      try {
        await this.enqueueDiagnostics(d.tenantId, d.id);
        enqueued += 1;
      } catch (err) {
        this.logger.error(`[TR-069] coleta proativa falhou device=${d.id}: ${String(err)}`);
      }
    }
    if (enqueued > 0) this.logger.debug(`[TR-069] coleta proativa enfileirou ${enqueued} device(s)`);
  }

  /**
   * Detecção de offline — CPE que parou de fazer Inform. Dois limiares: device
   * ainda no ZTP rápido cai rápido (OFFLINE_AFTER_MIN); device já relaxado (6h)
   * só é offline após ~2.5× o intervalo permanente + folga, senão a frota
   * inteira seria marcada offline 10 min depois de cada Inform de 6h.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async detectOffline(): Promise<void> {
    if (!this.enabled) return;
    const fastCutoff = new Date(Date.now() - OFFLINE_AFTER_MIN * 60_000);
    const relaxedOfflineMin = Math.max(
      OFFLINE_AFTER_MIN,
      Math.ceil((INFORM_RELAXED_INTERVAL / 60) * 2.5) + 15,
    );
    const relaxedCutoff = new Date(Date.now() - relaxedOfflineMin * 60_000);
    const stale = await this.prisma.tr069Device.findMany({
      where: {
        status: 'ONLINE',
        lastInformAt: { not: null },
        OR: [
          { informIntervalRelaxedAt: null, lastInformAt: { lt: fastCutoff } },
          { informIntervalRelaxedAt: { not: null }, lastInformAt: { lt: relaxedCutoff } },
        ],
      },
      select: { id: true, tenantId: true, deviceId: true, lastInformAt: true },
      take: CRON_BATCH,
    });
    for (const d of stale) {
      try {
        await this.prisma.tr069Device.update({ where: { id: d.id }, data: { status: 'OFFLINE' } });
        await this.openOfflineAlert(d.tenantId, d.id, d.lastInformAt);
      } catch (err) {
        this.logger.error(`[TR-069] detecção offline falhou device=${d.id}: ${String(err)}`);
      }
    }
    if (stale.length > 0) this.logger.warn(`[TR-069] ${stale.length} device(s) marcados OFFLINE`);
  }

  /** Abre (ou refresca) o alerta DEVICE_OFFLINE — 1 OPEN por device. */
  private async openOfflineAlert(
    tenantId: string,
    deviceId: string,
    lastInformAt: Date | null,
  ): Promise<void> {
    const since = lastInformAt ? lastInformAt.toISOString() : 'desconhecido';
    const existing = await this.prisma.tr069Alert.findFirst({
      where: { deviceId, type: 'DEVICE_OFFLINE', status: 'OPEN' },
      select: { id: true },
    });
    if (existing) {
      await this.prisma.tr069Alert.update({
        where: { id: existing.id },
        data: { lastSeenAt: new Date() },
      });
      return;
    }
    await this.prisma.tr069Alert.create({
      data: {
        tenantId,
        deviceId,
        type: 'DEVICE_OFFLINE',
        severity: 'WARNING',
        message: `CPE sem Inform há mais de ${OFFLINE_AFTER_MIN} min (último: ${since})`,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Mappers
  // ---------------------------------------------------------------------------

  private toDiagnosticDto(r: {
    id: string;
    capturedAt: Date;
    rxPower: Prisma.Decimal | null;
    txPower: Prisma.Decimal | null;
    temperature: Prisma.Decimal | null;
    voltage: Prisma.Decimal | null;
    biasCurrent: Prisma.Decimal | null;
    opticalHealth: string;
    gponStatus: string | null;
    fecErrors: bigint | null;
    hecErrors: bigint | null;
    dropRate: Prisma.Decimal | null;
    errorRate: Prisma.Decimal | null;
    pppStatus: string | null;
    pppLastError: string | null;
    wanUptime: number | null;
    hostsCount: number | null;
    hosts: Prisma.JsonValue | null;
    wifiClients24: number | null;
    wifiClients5: number | null;
    wifiChannel24: number | null;
    wifiChannel5: number | null;
    wifiWorstRssi: number | null;
    wifiClients: Prisma.JsonValue | null;
    cpuUsage: number | null;
    memUsage: number | null;
    deviceTemp: number | null;
    wanRxBytes: bigint | null;
    wanTxBytes: bigint | null;
  }): Tr069DiagnosticDto {
    return {
      id: r.id,
      capturedAt: r.capturedAt.toISOString(),
      rxPower: dec(r.rxPower),
      txPower: dec(r.txPower),
      temperature: dec(r.temperature),
      voltage: dec(r.voltage),
      biasCurrent: dec(r.biasCurrent),
      opticalHealth: r.opticalHealth as Tr069DiagnosticDto['opticalHealth'],
      gponStatus: r.gponStatus,
      fecErrors: r.fecErrors === null ? null : Number(r.fecErrors),
      hecErrors: r.hecErrors === null ? null : Number(r.hecErrors),
      dropRate: dec(r.dropRate),
      errorRate: dec(r.errorRate),
      pppStatus: r.pppStatus,
      pppLastError: r.pppLastError,
      wanUptime: r.wanUptime,
      hostsCount: r.hostsCount,
      hosts: Array.isArray(r.hosts) ? (r.hosts as unknown as Tr069LanHost[]) : [],
      wifiClients24: r.wifiClients24,
      wifiClients5: r.wifiClients5,
      wifiChannel24: r.wifiChannel24,
      wifiChannel5: r.wifiChannel5,
      wifiWorstRssi: r.wifiWorstRssi,
      wifiClients: Array.isArray(r.wifiClients)
        ? (r.wifiClients as unknown as Tr069WifiClient[])
        : [],
      cpuUsage: r.cpuUsage,
      memUsage: r.memUsage,
      deviceTemp: r.deviceTemp,
      wanRxBytes: r.wanRxBytes === null ? null : Number(r.wanRxBytes),
      wanTxBytes: r.wanTxBytes === null ? null : Number(r.wanTxBytes),
    };
  }

  private toAlertDto(a: {
    id: string;
    deviceId: string;
    type: string;
    severity: string;
    status: string;
    message: string;
    value: Prisma.Decimal | null;
    openedAt: Date;
    resolvedAt: Date | null;
    lastSeenAt: Date;
  }): Tr069AlertDto {
    return {
      id: a.id,
      deviceId: a.deviceId,
      type: a.type as Tr069AlertDto['type'],
      severity: a.severity as Tr069AlertDto['severity'],
      status: a.status as Tr069AlertDto['status'],
      message: a.message,
      value: dec(a.value),
      openedAt: a.openedAt.toISOString(),
      resolvedAt: a.resolvedAt?.toISOString() ?? null,
      lastSeenAt: a.lastSeenAt.toISOString(),
    };
  }

  private toTaskDto(t: {
    id: string;
    action: string;
    status: string;
    attempts: number;
    error: string | null;
    createdAt: Date;
    startedAt: Date | null;
    completedAt: Date | null;
  }): Tr069TaskDto {
    return {
      id: t.id,
      action: t.action,
      status: t.status,
      attempts: t.attempts,
      error: t.error,
      createdAt: t.createdAt.toISOString(),
      startedAt: t.startedAt?.toISOString() ?? null,
      completedAt: t.completedAt?.toISOString() ?? null,
    };
  }
}
