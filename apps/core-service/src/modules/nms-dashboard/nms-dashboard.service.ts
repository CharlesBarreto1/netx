/**
 * NmsDashboardService — o painel do NOC em uma leitura.
 *
 * Junta num único payload as fontes que hoje vivem separadas: sessões RADIUS
 * (Core), telemetria da frota (NMS, via HTTP), planta óptica e OLTs (Core) e os
 * incidentes correlacionados do motor de alarmes (Core). Uma chamada só porque
 * o painel é tela de parede: seis requisições independentes chegariam em
 * momentos diferentes e o operador leria blocos de instantes distintos como se
 * fossem o mesmo instante.
 *
 * ALARMES: os de tendência (queda de PPPoE, tráfego anômalo) são derivados AQUI,
 * a cada leitura, comparando o agora com o baseline em `network_snapshots` —
 * não são persistidos. Isso é deliberado: alarme de tendência que se grava
 * precisa de alguém pra fechá-lo, e um painel cheio de alarmes velhos de uma
 * rede que já normalizou é pior que nenhum. Os incidentes que PRECISAM de
 * ciclo de vida (ack/resolve) continuam sendo os `Incident` do correlacionador
 * de syslog, que este painel apenas exibe.
 */
import { Injectable } from '@nestjs/common';

import { AlarmsService } from '../alarms/alarms.service';
import { PrismaService } from '../prisma/prisma.service';
import { RadacctService } from '../radius/radacct.service';
import { deriveAlarms, type AlarmThresholds } from './alarm-rules';
import { NmsClientService, type NmsFleetSummary } from './nms-client.service';
import type {
  CapacityPanel,
  DevicesPanel,
  NmsDashboard,
  OltPanel,
  OpticalPanel,
  SessionsPanel,
  SnapshotPoint,
  TrafficPanel,
} from './nms-dashboard.types';

// ── Limiares dos alarmes de tendência ──────────────────────────────────────
// Todos configuráveis por env: cada rede tem um "normal" diferente, e um
// limiar errado é a diferença entre alarme útil e alarme que se aprende a
// ignorar.

/** Queda % de sessões contra o baseline que dispara WARNING. */
const PPPOE_DROP_WARN_PCT = Number(process.env.NMS_PPPOE_DROP_WARN_PCT ?? 10);
/** Queda % que dispara CRITICAL. */
const PPPOE_DROP_CRIT_PCT = Number(process.env.NMS_PPPOE_DROP_CRIT_PCT ?? 25);
/**
 * Piso absoluto de sessões perdidas. Evita o falso-positivo estrutural do
 * percentual: num tenant com 12 clientes, 2 desconexões normais viram "17% de
 * queda" e alarmariam toda noite.
 */
const PPPOE_DROP_MIN_ABS = Number(process.env.NMS_PPPOE_DROP_MIN_ABS ?? 5);

/** Variação % de tráfego (pra baixo/cima) que dispara WARNING. */
const TRAFFIC_DELTA_WARN_PCT = Number(process.env.NMS_TRAFFIC_DELTA_WARN_PCT ?? 40);
/** Variação % que dispara CRITICAL. */
const TRAFFIC_DELTA_CRIT_PCT = Number(process.env.NMS_TRAFFIC_DELTA_CRIT_PCT ?? 65);
/**
 * Piso de tráfego pra avaliar variação (bps). Abaixo disto o percentual é
 * ruído — 1 Mbps virando 3 Mbps de madrugada é +200% e não significa nada.
 */
const TRAFFIC_MIN_BPS = Number(process.env.NMS_TRAFFIC_MIN_BPS ?? 10_000_000);

/** Amostras usadas como baseline. 12 × 5 min = 1 hora. */
const BASELINE_SAMPLES = Number(process.env.NMS_BASELINE_SAMPLES ?? 12);
/** Amostras devolvidas pro sparkline. 72 × 5 min = 6 horas. */
const SERIES_SAMPLES = Number(process.env.NMS_SERIES_SAMPLES ?? 72);

/** CPU % acima da qual o device entra no bloco "quentes". */
const CPU_HOT_PCT = Number(process.env.NMS_CPU_HOT_PCT ?? 85);
/** Temperatura °C acima da qual o device entra no bloco "quentes". */
const TEMP_HOT_C = Number(process.env.NMS_TEMP_HOT_C ?? 70);
/** Sem métrica há mais que isto (min), a telemetria do device é considerada velha. */
const STALE_MIN = Number(process.env.NMS_STALE_TELEMETRY_MIN ?? 15);

/** ONTs listadas no "piores casos" da saúde óptica. */
const WORST_OPTICAL_LIMIT = 10;

/** Limiares passados às regras puras de alarme (ver `alarm-rules.ts`). */
const THRESHOLDS: AlarmThresholds = {
  pppoeDropWarnPct: PPPOE_DROP_WARN_PCT,
  pppoeDropCritPct: PPPOE_DROP_CRIT_PCT,
  pppoeDropMinAbs: PPPOE_DROP_MIN_ABS,
  trafficDeltaWarnPct: TRAFFIC_DELTA_WARN_PCT,
  trafficDeltaCritPct: TRAFFIC_DELTA_CRIT_PCT,
  trafficMinBps: TRAFFIC_MIN_BPS,
  staleMin: STALE_MIN,
};

@Injectable()
export class NmsDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly radacct: RadacctService,
    private readonly nms: NmsClientService,
    private readonly alarms: AlarmsService,
  ) {}

  async build(tenantId: string): Promise<NmsDashboard> {
    // Tudo que é independente vai junto: o painel inteiro custa o bloco mais
    // lento, não a soma deles.
    const [fleet, snapshots, policy, online, olts, optical, incidents, desynced] =
      await Promise.all([
        this.nms.fleetSummary(),
        this.recentSnapshots(tenantId),
        this.alarms.getPolicy(tenantId),
        this.radacct.getOnlineSnapshot(tenantId),
        this.oltPanel(tenantId),
        this.opticalPanelData(tenantId),
        this.openIncidents(tenantId),
        this.desyncedCount(tenantId),
      ]);

    const sessions = this.sessionsPanel(online, snapshots);
    const traffic = this.trafficPanel(fleet, snapshots);
    const devices = this.devicesPanel(fleet, desynced);
    const opticalPanel = this.opticalPanel(optical, policy.rxLowDbm, policy.rxHighDbm);
    const capacity = this.capacityPanel(fleet);

    return {
      generatedAt: new Date().toISOString(),
      alarms: deriveAlarms({ sessions, traffic, devices, olts, optical: opticalPanel }, THRESHOLDS),
      sessions,
      traffic,
      devices,
      optical: opticalPanel,
      olts,
      capacity,
      incidents,
      nmsAvailable: fleet !== null,
    };
  }

  // ── Histórico ────────────────────────────────────────────────────────────

  /**
   * Últimas amostras do tenant, mais ANTIGA primeiro (ordem de gráfico). A
   * query pede DESC pra usar o índice `(tenant_id, at)` e pegar as N mais
   * recentes; a inversão acontece na memória, sobre no máximo SERIES_SAMPLES
   * linhas.
   */
  private async recentSnapshots(tenantId: string): Promise<SnapshotPoint[]> {
    const rows = await this.prisma.networkSnapshot.findMany({
      where: { tenantId },
      orderBy: { at: 'desc' },
      take: SERIES_SAMPLES,
      select: { at: true, activeSessions: true, totalInBps: true, totalOutBps: true },
    });
    return rows
      .map((r) => ({
        t: r.at.toISOString(),
        activeSessions: r.activeSessions,
        totalInBps: r.totalInBps === null ? null : Number(r.totalInBps),
        totalOutBps: r.totalOutBps === null ? null : Number(r.totalOutBps),
      }))
      .reverse();
  }

  /** Média dos últimos N valores não-nulos, ou null se não há amostra. */
  private baseline(values: Array<number | null>): number | null {
    const usable = values.filter((v): v is number => v !== null).slice(-BASELINE_SAMPLES);
    if (usable.length === 0) return null;
    return usable.reduce((a, b) => a + b, 0) / usable.length;
  }

  /** Variação percentual de `current` contra `base`. Null se base é 0/ausente. */
  private deltaPct(current: number | null, base: number | null): number | null {
    if (current === null || base === null || base === 0) return null;
    return ((current - base) / base) * 100;
  }

  // ── Blocos ───────────────────────────────────────────────────────────────

  private sessionsPanel(
    online: { online: number; totalActive: number; snapshotAt: string },
    snapshots: SnapshotPoint[],
  ): SessionsPanel {
    // O baseline exclui a amostra mais recente pra não diluir a própria queda:
    // incluí-la puxaria a média na direção do valor atual, encolhendo o delta
    // justamente no momento em que ele precisa aparecer.
    const base = this.baseline(snapshots.slice(0, -1).map((s) => s.activeSessions));
    return {
      active: online.online,
      contracts: online.totalActive,
      baseline: base === null ? null : Math.round(base),
      deltaPct: this.deltaPct(online.online, base),
      at: online.snapshotAt,
    };
  }

  private trafficPanel(fleet: NmsFleetSummary | null, snapshots: SnapshotPoint[]): TrafficPanel {
    const inBps = fleet ? fleet.totalInBps : null;
    const outBps = fleet ? fleet.totalOutBps : null;
    const current = fleet ? fleet.totalInBps + fleet.totalOutBps : null;
    const base = this.baseline(
      snapshots
        .slice(0, -1)
        .map((s) => (s.totalInBps === null || s.totalOutBps === null ? null : s.totalInBps + s.totalOutBps)),
    );
    return {
      inBps,
      outBps,
      baselineBps: base,
      deltaPct: this.deltaPct(current, base),
      series: snapshots,
    };
  }

  private devicesPanel(fleet: NmsFleetSummary | null, desynced: number): DevicesPanel {
    if (!fleet) {
      return { total: null, online: null, offline: null, desynced, staleTelemetry: 0 };
    }
    const cutoff = Date.now() - STALE_MIN * 60_000;
    const stale = fleet.devices.filter(
      (d) => d.lastSeen === null || new Date(d.lastSeen).getTime() < cutoff,
    ).length;
    return {
      total: fleet.deviceCount,
      online: fleet.online,
      offline: fleet.offline,
      desynced,
      staleTelemetry: stale,
    };
  }

  /**
   * Equipamentos marcados pra monitorar que não têm espelho no NMS — ou porque
   * o sync falhou, ou porque nunca rodou. É a divergência silenciosa entre
   * Planta e NMS, que só aparece se alguém a contar.
   */
  private async desyncedCount(tenantId: string): Promise<number> {
    return this.prisma.networkEquipment.count({
      where: {
        tenantId,
        nmsMonitored: true,
        deletedAt: null,
        OR: [{ nmsDeviceId: null }, { nmsSyncError: { not: null } }],
      },
    });
  }

  private capacityPanel(fleet: NmsFleetSummary | null): CapacityPanel {
    if (!fleet) return { topDevices: [], saturated: [], hot: [] };

    const topDevices = fleet.devices
      .map((d) => ({ id: d.id, hostname: d.hostname, site: d.site, totalBps: d.inBps + d.outBps }))
      .filter((d) => d.totalBps > 0)
      .sort((a, b) => b.totalBps - a.totalBps)
      .slice(0, 5);

    const hot = fleet.devices
      .filter((d) => (d.cpuPct ?? 0) >= CPU_HOT_PCT || (d.tempC ?? 0) >= TEMP_HOT_C)
      .map((d) => ({ id: d.id, hostname: d.hostname, cpuPct: d.cpuPct, tempC: d.tempC }));

    // Saturação por interface exigiria a capacidade nominal de cada porta, que
    // o /summary do NMS não devolve (ele agrega por device). Fica vazio até o
    // NMS expor ifHighSpeed no summary — melhor um bloco honestamente vazio
    // que um número inventado a partir de capacidade presumida.
    return { topDevices, saturated: [], hot };
  }

  private async oltPanel(tenantId: string): Promise<OltPanel> {
    const olts = await this.prisma.olt.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, vendor: true, status: true, lastSeenAt: true },
    });

    // Contagem de ONTs por (olt, status) numa query só — buscar as ONTs de cada
    // OLT em loop seria N+1 numa tela que atualiza sozinha.
    const grouped = await this.prisma.ont.groupBy({
      by: ['oltId', 'status'],
      where: { tenantId },
      _count: { _all: true },
    });

    const byOlt = new Map<string, { total: number; online: number; offline: number }>();
    for (const g of grouped) {
      const acc = byOlt.get(g.oltId) ?? { total: 0, online: 0, offline: 0 };
      const n = g._count._all;
      acc.total += n;
      if (g.status === 'ONLINE') acc.online += n;
      // LOS e FAULT contam como offline: pro painel, o que importa é "não está
      // entregando serviço", não a razão óptica exata (essa está no bloco de
      // saúde óptica).
      if (g.status === 'OFFLINE' || g.status === 'LOS' || g.status === 'FAULT') acc.offline += n;
      byOlt.set(g.oltId, acc);
    }

    const items = olts.map((o) => {
      const c = byOlt.get(o.id) ?? { total: 0, online: 0, offline: 0 };
      return {
        id: o.id,
        name: o.name,
        vendor: o.vendor as string,
        status: o.status as string,
        lastSeenAt: o.lastSeenAt ? o.lastSeenAt.toISOString() : null,
        ontsTotal: c.total,
        ontsOnline: c.online,
        ontsOffline: c.offline,
      };
    });

    return {
      total: items.length,
      online: items.filter((o) => o.status === 'ONLINE').length,
      offline: items.filter((o) => o.status !== 'ONLINE' && o.status !== 'UNKNOWN').length,
      items,
    };
  }

  /** ONTs com leitura óptica ou em estado crítico — matéria-prima do bloco. */
  private async opticalPanelData(tenantId: string): Promise<
    Array<{
      id: string;
      contractId: string;
      snGpon: string;
      status: string;
      lastRxPower: number | null;
      oltName: string;
    }>
  > {
    const onts = await this.prisma.ont.findMany({
      where: {
        tenantId,
        // ONT que nunca autorizou não tem óptica pra avaliar e poluiria as
        // faixas com "sem leitura".
        status: { not: 'PENDING_AUTH' },
      },
      select: {
        id: true,
        contractId: true,
        snGpon: true,
        status: true,
        lastRxPower: true,
        olt: { select: { name: true } },
      },
    });
    return onts.map((o) => ({
      id: o.id,
      contractId: o.contractId,
      snGpon: o.snGpon,
      status: o.status as string,
      lastRxPower: o.lastRxPower === null ? null : Number(o.lastRxPower),
      oltName: o.olt.name,
    }));
  }

  private opticalPanel(
    onts: Awaited<ReturnType<NmsDashboardService['opticalPanelData']>>,
    rxLowDbm: number,
    rxHighDbm: number,
  ): OpticalPanel {
    let ok = 0;
    let low = 0;
    let high = 0;
    let measured = 0;
    const critical = onts.filter((o) => o.status === 'LOS' || o.status === 'FAULT').length;

    for (const o of onts) {
      if (o.lastRxPower === null) continue;
      measured++;
      if (o.lastRxPower < rxLowDbm) low++;
      else if (o.lastRxPower > rxHighDbm) high++;
      else ok++;
    }

    // Piores primeiro: LOS/FAULT no topo (perderam sinal), depois os RX mais
    // baixos. Sem leitura vai por último — não é problema conhecido.
    const worst = [...onts]
      .filter((o) => o.status === 'LOS' || o.status === 'FAULT' || (o.lastRxPower !== null && (o.lastRxPower < rxLowDbm || o.lastRxPower > rxHighDbm)))
      .sort((a, b) => {
        const crit = (x: typeof a): number => (x.status === 'LOS' || x.status === 'FAULT' ? 0 : 1);
        if (crit(a) !== crit(b)) return crit(a) - crit(b);
        return (a.lastRxPower ?? Infinity) - (b.lastRxPower ?? Infinity);
      })
      .slice(0, WORST_OPTICAL_LIMIT)
      .map((o) => ({
        ontId: o.id,
        contractId: o.contractId,
        snGpon: o.snGpon,
        oltName: o.oltName,
        rxDbm: o.lastRxPower,
        status: o.status,
      }));

    return { measured, ok, low, high, critical, rxLowDbm, rxHighDbm, worst };
  }

  private async openIncidents(tenantId: string): Promise<NmsDashboard['incidents']> {
    const rows = await this.prisma.incident.findMany({
      where: { tenantId, status: { in: ['OPEN', 'ACK'] } },
      orderBy: [{ severity: 'desc' }, { lastEventAt: 'desc' }],
      take: 10,
      select: {
        id: true,
        scope: true,
        scopeLabel: true,
        severity: true,
        rootCause: true,
        affectedCount: true,
        totalInScope: true,
        affectedPct: true,
        firstEventAt: true,
        lastEventAt: true,
      },
    });
    return rows.map((i) => ({
      id: i.id,
      scope: i.scope as string,
      scopeLabel: i.scopeLabel,
      severity: i.severity as string,
      rootCause: i.rootCause as string,
      affectedCount: i.affectedCount,
      totalInScope: i.totalInScope,
      affectedPct: Number(i.affectedPct),
      firstEventAt: i.firstEventAt.toISOString(),
      lastEventAt: i.lastEventAt.toISOString(),
    }));
  }

}
