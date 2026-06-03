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
  type Tr069DeviceDetailResponse,
  type Tr069DiagnosticDto,
  type Tr069DiagRunDto,
  type Tr069LanHost,
  type Tr069RefreshResponse,
  type ListWifiCoverageQuery,
  type WifiCoverageRow,
  type Tr069TaskDto,
  type Tr069WifiClient,
} from '@netx/shared';

import { CryptoService } from '../crypto/crypto.service';

import { PrismaService } from '../prisma/prisma.service';
import { performConnectionRequest } from './tr069-connection-request';
import {
  HUAWEI_EG8145_PATHS,
  huaweiDiagnosticParamNames,
  huaweiNotificationAttributes,
  TR143_DOWNLOAD,
  TR143_PING,
  TR143_UPLOAD,
} from './tr069-paths.huawei';

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
/** Intervalo permanente de Inform (s) após o relaxamento. Default 6h. */
const INFORM_RELAXED_INTERVAL = parseInt(process.env.TR069_INFORM_RELAXED_INTERVAL ?? '21600', 10);

function dec(d: Prisma.Decimal | null): number | null {
  return d === null ? null : Number(d);
}

@Injectable()
export class Tr069DiagnosticsService {
  private readonly logger = new Logger(Tr069DiagnosticsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
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

    const task = await this.prisma.tr069Task.create({
      data: {
        tenantId,
        deviceId: deviceDbId,
        action: 'GET_PARAMS',
        payload: { names: huaweiDiagnosticParamNames(), purpose: 'DIAGNOSTICS' },
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
    const task = await this.prisma.tr069Task.create({
      data: {
        tenantId,
        deviceId: deviceDbId,
        action: 'SET_ATTRIBUTES',
        payload: { attributes: huaweiNotificationAttributes() },
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

  async getDeviceDetail(tenantId: string, deviceId: string): Promise<Tr069DeviceDetailResponse> {
    const device = await this.prisma.tr069Device.findFirst({
      where: { id: deviceId, tenantId },
      include: {
        ont: {
          select: {
            id: true,
            snGpon: true,
            contractId: true,
            status: true,
            lastRxPower: true,
            lastTxPower: true,
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
            contractId: device.ont.contractId,
            status: device.ont.status,
            lastRxPower: device.ont.lastRxPower === null ? null : String(device.ont.lastRxPower),
            lastTxPower: device.ont.lastTxPower === null ? null : String(device.ont.lastTxPower),
          }
        : null,
      latest: latest ? this.toDiagnosticDto(latest) : null,
      openAlerts: device.alerts.map((a) => this.toAlertDto(a)),
      recentTasks: device.tasks.map((t) => this.toTaskDto(t)),
    };
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
   * 6h). Reduz tráfego de Inform/carga do ACS no regime estável — as
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
