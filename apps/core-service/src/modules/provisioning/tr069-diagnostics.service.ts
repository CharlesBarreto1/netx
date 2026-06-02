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
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import {
  paginationMeta,
  type ListTr069AlertsQuery,
  type Paginated,
  type Tr069AlertDto,
  type Tr069DeviceDetailResponse,
  type Tr069DiagnosticDto,
  type Tr069RefreshResponse,
  type Tr069TaskDto,
} from '@netx/shared';

import { PrismaService } from '../prisma/prisma.service';
import { huaweiDiagnosticParamNames } from './tr069-paths.huawei';

/** Intervalo (min) entre coletas proativas por device. */
const DIAGNOSTIC_INTERVAL_MIN = parseInt(process.env.TR069_DIAGNOSTIC_INTERVAL_MIN ?? '15', 10);
/** Minutos sem Inform até considerar o CPE offline. */
const OFFLINE_AFTER_MIN = parseInt(process.env.TR069_OFFLINE_AFTER_MIN ?? '10', 10);
/** Quantos devices processar por tick de cron (proteção contra varredura gigante). */
const CRON_BATCH = 200;

function dec(d: Prisma.Decimal | null): number | null {
  return d === null ? null : Number(d);
}

@Injectable()
export class Tr069DiagnosticsService {
  private readonly logger = new Logger(Tr069DiagnosticsService.name);

  constructor(private readonly prisma: PrismaService) {}

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

  /** Pedido manual de refresh (botão na UI). */
  async requestRefresh(tenantId: string, deviceId: string): Promise<Tr069RefreshResponse> {
    const device = await this.prisma.tr069Device.findFirst({
      where: { id: deviceId, tenantId },
      select: { id: true },
    });
    if (!device) throw new NotFoundException('Device TR-069 não encontrado');
    const { taskId } = await this.enqueueDiagnostics(tenantId, device.id);
    return {
      taskId,
      message: 'Coleta enfileirada — será aplicada no próximo Inform do CPE (até ~1 min).',
    };
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

  /** Detecção de offline — CPE que parou de fazer Inform. */
  @Cron(CronExpression.EVERY_MINUTE)
  async detectOffline(): Promise<void> {
    if (!this.enabled) return;
    const cutoff = new Date(Date.now() - OFFLINE_AFTER_MIN * 60_000);
    const stale = await this.prisma.tr069Device.findMany({
      where: {
        status: 'ONLINE',
        lastInformAt: { not: null, lt: cutoff },
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
    wifiClients24: number | null;
    wifiClients5: number | null;
    wifiChannel24: number | null;
    wifiChannel5: number | null;
    wifiWorstRssi: number | null;
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
      wifiClients24: r.wifiClients24,
      wifiClients5: r.wifiClients5,
      wifiChannel24: r.wifiChannel24,
      wifiChannel5: r.wifiChannel5,
      wifiWorstRssi: r.wifiWorstRssi,
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
