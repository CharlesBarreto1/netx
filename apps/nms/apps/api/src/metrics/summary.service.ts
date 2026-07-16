import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { MetricsService } from './metrics.service.js';

export interface FleetDevice {
  id: string;
  hostname: string;
  mgmtIp: string;
  vendor: string;
  model: string | null;
  site: string | null;
  inBps: number;
  outBps: number;
  cpuPct: number | null;
  tempC: number | null;
  ifCount: number;
  online: boolean;
  lastSeen: string | null;
}

export interface TrafficPoint {
  t: string;
  inBps: number;
  outBps: number;
}

export interface FleetSummary {
  deviceCount: number;
  online: number;
  offline: number;
  totalInBps: number;
  totalOutBps: number;
  series: TrafficPoint[];
  devices: FleetDevice[];
}

/** Considera "online" o device com métrica de interface nos últimos 5 min. */
const ONLINE_WINDOW_MS = 5 * 60_000;

/**
 * Telemetria agregada da frota para o cockpit do NetX (dashboard NOC). Soma
 * tráfego/saúde por device a partir do MESMO Timescale que alimenta as telas do
 * NMS — dados reais, não mock. Consumido via gateway em `/v1/nms/summary`.
 */
@Injectable()
export class SummaryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
  ) {}

  async fleet(): Promise<FleetSummary> {
    const devices = await this.prisma.device.findMany({ orderBy: { hostname: 'asc' } });
    const items = await Promise.all(devices.map((d) => this.deviceSummary(d)));
    const totalInBps = items.reduce((a, i) => a + i.inBps, 0);
    const totalOutBps = items.reduce((a, i) => a + i.outBps, 0);
    const online = items.filter((i) => i.online).length;
    const series = await this.trafficSeries().catch(() => [] as TrafficPoint[]);
    return {
      deviceCount: devices.length,
      online,
      offline: devices.length - online,
      totalInBps,
      totalOutBps,
      series,
      devices: items,
    };
  }

  private async deviceSummary(d: {
    id: string;
    hostname: string;
    mgmtIp: string;
    vendor: string;
    model: string | null;
    site: string | null;
  }): Promise<FleetDevice> {
    const [rates, system, lastSeen] = await Promise.all([
      this.metrics.interfaceRates(d.id).catch(() => []),
      this.metrics.system(d.id).catch(() => []),
      this.lastSeen(d.id).catch(() => null),
    ]);
    const inBps = rates.reduce((a, r) => a + (r.inBps ?? 0), 0);
    const outBps = rates.reduce((a, r) => a + (r.outBps ?? 0), 0);
    const cpuVals = system.map((s) => s.cpuPct).filter((v): v is number => v != null);
    const tempVals = system.map((s) => s.tempC).filter((v): v is number => v != null);
    const online = lastSeen ? Date.now() - lastSeen.getTime() < ONLINE_WINDOW_MS : false;
    return {
      id: d.id,
      hostname: d.hostname,
      mgmtIp: d.mgmtIp,
      vendor: d.vendor,
      model: d.model ?? null,
      site: d.site ?? null,
      inBps,
      outBps,
      cpuPct: cpuVals.length ? Math.max(...cpuVals) : null,
      tempC: tempVals.length ? Math.max(...tempVals) : null,
      ifCount: rates.length,
      online,
      lastSeen: lastSeen ? lastSeen.toISOString() : null,
    };
  }

  private async lastSeen(deviceId: string): Promise<Date | null> {
    const rows = await this.prisma.$queryRawUnsafe<{ t: Date | null }[]>(
      `SELECT max(time) AS t FROM metrics.snmp_interface WHERE device_id = $1`,
      deviceId,
    );
    return rows[0]?.t ?? null;
  }

  /**
   * Série de tráfego agregado (bps) por bucket de 5 min na última hora, somando
   * todas as interfaces de todos os devices. Aproxima a taxa por (Δcontador /
   * segundos do bucket); GREATEST(...,0) descarta reset de contador.
   */
  private async trafficSeries(): Promise<TrafficPoint[]> {
    const rows = await this.prisma.$queryRawUnsafe<{ t: Date; inBps: number; outBps: number }[]>(
      `WITH per_if AS (
         SELECT time_bucket('5 minutes', time) AS bucket, device_id, "ifName",
                max("ifHCInOctets") - min("ifHCInOctets") AS d_in,
                max("ifHCOutOctets") - min("ifHCOutOctets") AS d_out
         FROM metrics.snmp_interface
         WHERE time > now() - interval '1 hour'
         GROUP BY 1, 2, 3
       )
       SELECT bucket AS t,
              (GREATEST(sum(d_in), 0) * 8.0 / 300)::float8 AS "inBps",
              (GREATEST(sum(d_out), 0) * 8.0 / 300)::float8 AS "outBps"
       FROM per_if
       GROUP BY bucket
       ORDER BY bucket`,
    );
    return rows.map((r) => ({
      t: r.t instanceof Date ? r.t.toISOString() : String(r.t),
      inBps: r.inBps,
      outBps: r.outBps,
    }));
  }
}
