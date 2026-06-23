/**
 * AlarmsService — leitura/ack/resolve de incidents + CRUD da AlarmPolicy.
 * O motor que ABRE incidents é o IncidentCorrelator; aqui é a superfície de
 * consulta/operação pra UI e a config por tenant.
 *
 * @provenance Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import {
  paginationMeta,
  type AlarmPolicyResponse,
  type CtoRssiResponse,
  type IncidentResponse,
  type ListIncidentsQuery,
  type OntSignal,
  type Paginated,
  type SignalFlag,
  type SignalReportItem,
  type UpdateAlarmPolicy,
} from '@netx/shared';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

type IncidentRow = Prisma.IncidentGetPayload<object>;

function toResponse(i: IncidentRow): IncidentResponse {
  return {
    id: i.id,
    tenantId: i.tenantId,
    scope: i.scope,
    scopeRefId: i.scopeRefId,
    scopeLabel: i.scopeLabel,
    severity: i.severity,
    status: i.status,
    rootCause: i.rootCause,
    affectedCount: i.affectedCount,
    totalInScope: i.totalInScope,
    affectedPct: Number(i.affectedPct),
    parentIncidentId: i.parentIncidentId,
    aiSummary: i.aiSummary,
    aiRootCause: i.aiRootCause,
    firstEventAt: i.firstEventAt.toISOString(),
    lastEventAt: i.lastEventAt.toISOString(),
    acknowledgedAt: i.acknowledgedAt?.toISOString() ?? null,
    resolvedAt: i.resolvedAt?.toISOString() ?? null,
    createdAt: i.createdAt.toISOString(),
    updatedAt: i.updatedAt.toISOString(),
  };
}

function flagFor(rx: number | null, low: number, high: number): SignalFlag {
  if (rx == null) return 'OK';
  if (rx < low) return 'LOW';
  if (rx > high) return 'HIGH';
  return 'OK';
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const POLICY_DEFAULTS = {
  ctoPctThreshold: 60,
  ctoMinCount: 3,
  ponPctThreshold: 50,
  ponMinCount: 4,
  cablePctThreshold: 50,
  cableMinCount: 2,
  oltMinCount: 10,
  geoMinCount: 5,
  debounceSeconds: 45,
  rxLowDbm: -27,
  rxHighDbm: -8,
};

@Injectable()
export class AlarmsService {
  constructor(private readonly prisma: PrismaService) {}

  async listIncidents(
    tenantId: string,
    q: ListIncidentsQuery,
  ): Promise<Paginated<IncidentResponse>> {
    const where: Prisma.IncidentWhereInput = {
      tenantId,
      ...(q.status && { status: q.status }),
      ...(q.severity && { severity: q.severity }),
      ...(q.scope && { scope: q.scope }),
      // Por padrão esconde os suprimidos (filhos de um incident maior).
      ...(q.includeSuppressed ? {} : { parentIncidentId: null }),
    };
    const skip = (q.page - 1) * q.pageSize;
    const [rows, total] = await Promise.all([
      this.prisma.incident.findMany({
        where,
        orderBy: [{ status: 'asc' }, { severity: 'desc' }, { lastEventAt: 'desc' }],
        skip,
        take: q.pageSize,
      }),
      this.prisma.incident.count({ where }),
    ]);
    return {
      data: rows.map(toResponse),
      pagination: paginationMeta(total, q.page, q.pageSize),
    };
  }

  async getIncident(tenantId: string, id: string): Promise<IncidentResponse> {
    const row = await this.prisma.incident.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundException('Incidente não encontrado');
    return toResponse(row);
  }

  async acknowledge(tenantId: string, userId: string, id: string): Promise<IncidentResponse> {
    await this.assertExists(tenantId, id);
    const updated = await this.prisma.incident.update({
      where: { id },
      data: { status: 'ACK', acknowledgedAt: new Date(), acknowledgedById: userId },
    });
    return toResponse(updated);
  }

  async resolve(tenantId: string, id: string): Promise<IncidentResponse> {
    await this.assertExists(tenantId, id);
    const updated = await this.prisma.incident.update({
      where: { id },
      data: { status: 'RESOLVED', resolvedAt: new Date() },
    });
    return toResponse(updated);
  }

  async getPolicy(tenantId: string): Promise<AlarmPolicyResponse> {
    const p = await this.prisma.alarmPolicy.findUnique({ where: { tenantId } });
    if (!p) {
      return { ...POLICY_DEFAULTS, severityMap: null, updatedAt: null };
    }
    return {
      ctoPctThreshold: p.ctoPctThreshold,
      ctoMinCount: p.ctoMinCount,
      ponPctThreshold: p.ponPctThreshold,
      ponMinCount: p.ponMinCount,
      cablePctThreshold: p.cablePctThreshold,
      cableMinCount: p.cableMinCount,
      oltMinCount: p.oltMinCount,
      geoMinCount: p.geoMinCount,
      debounceSeconds: p.debounceSeconds,
      rxLowDbm: Number(p.rxLowDbm),
      rxHighDbm: Number(p.rxHighDbm),
      severityMap: (p.severityMap as Record<string, never> | null) ?? null,
      updatedAt: p.updatedAt.toISOString(),
    };
  }

  async updatePolicy(tenantId: string, input: UpdateAlarmPolicy): Promise<AlarmPolicyResponse> {
    const data: Prisma.AlarmPolicyUncheckedCreateInput = { tenantId };
    const upd: Prisma.AlarmPolicyUpdateInput = {};
    const set = <K extends keyof UpdateAlarmPolicy>(k: K): void => {
      if (input[k] === undefined) return;
      const v = k === 'severityMap' ? (input[k] ?? Prisma.DbNull) : input[k];
      (data as Record<string, unknown>)[k] = v;
      (upd as Record<string, unknown>)[k] = v;
    };
    (Object.keys(input) as (keyof UpdateAlarmPolicy)[]).forEach(set);

    await this.prisma.alarmPolicy.upsert({
      where: { tenantId },
      create: data,
      update: upd,
    });
    return this.getPolicy(tenantId);
  }

  // ── RSSI / sinal (F5) ──────────────────────────────────────────────────────

  /** RSSI médio + por-ONT de uma CTO, com flags de sinal ruim/saturado. */
  async rssiByCto(tenantId: string, ctoId: string): Promise<CtoRssiResponse> {
    const { low, high } = await this.signalThresholds(tenantId);
    const onts = await this.prisma.ont.findMany({
      where: { tenantId, contract: { opticalPort: { enclosureId: ctoId } } },
      select: {
        id: true,
        snGpon: true,
        status: true,
        lastRxPower: true,
        lastTxPower: true,
        contract: { select: { code: true } },
      },
    });
    const mapped: OntSignal[] = onts.map((o) => {
      const rx = o.lastRxPower != null ? Number(o.lastRxPower) : null;
      return {
        ontId: o.id,
        snGpon: o.snGpon,
        contractCode: o.contract?.code ?? null,
        status: o.status,
        rxPower: rx,
        txPower: o.lastTxPower != null ? Number(o.lastTxPower) : null,
        flag: flagFor(rx, low, high),
      };
    });
    const reads = mapped.map((m) => m.rxPower).filter((v): v is number => v != null);
    return {
      ctoId,
      ontCount: mapped.length,
      withReading: reads.length,
      rxAvg: reads.length ? round2(reads.reduce((a, b) => a + b, 0) / reads.length) : null,
      rxMin: reads.length ? Math.min(...reads) : null,
      rxMax: reads.length ? Math.max(...reads) : null,
      lowCount: mapped.filter((m) => m.flag === 'LOW').length,
      highCount: mapped.filter((m) => m.flag === 'HIGH').length,
      onts: mapped.sort((a, b) => (a.rxPower ?? 0) - (b.rxPower ?? 0)),
    };
  }

  /** Relatório de clientes com sinal ruim (LOW) ou saturado (HIGH). */
  async signalReport(tenantId: string): Promise<SignalReportItem[]> {
    const { low, high } = await this.signalThresholds(tenantId);
    const onts = await this.prisma.ont.findMany({
      where: { tenantId, lastRxPower: { not: null } },
      select: { id: true, snGpon: true, lastRxPower: true, contract: { select: { code: true } } },
    });
    return onts
      .map((o) => {
        const rx = o.lastRxPower != null ? Number(o.lastRxPower) : null;
        return {
          ontId: o.id,
          snGpon: o.snGpon,
          contractCode: o.contract?.code ?? null,
          rxPower: rx,
          flag: flagFor(rx, low, high),
        };
      })
      .filter((i) => i.flag !== 'OK')
      .sort((a, b) => (a.rxPower ?? 0) - (b.rxPower ?? 0));
  }

  private async signalThresholds(tenantId: string): Promise<{ low: number; high: number }> {
    const p = await this.prisma.alarmPolicy.findUnique({
      where: { tenantId },
      select: { rxLowDbm: true, rxHighDbm: true },
    });
    return { low: p ? Number(p.rxLowDbm) : -27, high: p ? Number(p.rxHighDbm) : -8 };
  }

  private async assertExists(tenantId: string, id: string): Promise<void> {
    const row = await this.prisma.incident.findFirst({ where: { id, tenantId }, select: { id: true } });
    if (!row) throw new NotFoundException('Incidente não encontrado');
  }
}
