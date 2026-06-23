import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { DevicesService } from '../devices/devices.service.js';

type Severity = 'info' | 'warning' | 'error' | 'critical';

interface MetricDef {
  key: string;
  label: string;
  unit: string;
  table: string;
  entityCol: string;
  valExpr: string; // expressão SQL do valor (whitelist — sem input do usuário)
  filter: string; // condição extra (whitelist)
}

/** Sinais monitorados. Todas as expressões são constantes (sem injeção). */
const METRICS: MetricDef[] = [
  {
    key: 'optical-rx',
    label: 'luz RX óptica',
    unit: 'dBm',
    table: 'metrics.snmp_optical',
    entityCol: '"ifName"',
    valExpr: '"rxLaserPower"/100.0',
    filter: 'AND "rxLaserPower" <> 0',
  },
  {
    key: 'temp',
    label: 'temperatura',
    unit: '°C',
    table: 'metrics.snmp_juniper_operating',
    entityCol: '"jnxOperatingDescr"',
    valExpr: '"jnxOperatingTemp"',
    filter: 'AND "jnxOperatingTemp" > 0',
  },
  {
    key: 'cpu',
    label: 'CPU',
    unit: '%',
    table: 'metrics.snmp_juniper_operating',
    entityCol: '"jnxOperatingDescr"',
    valExpr: '"jnxOperatingCPU"',
    filter: 'AND "jnxOperatingCPU" > 0',
  },
];

const Z_THRESHOLD = 3;

interface BaselineRow {
  entity: string;
  latest: number | null;
  mean: number | null;
  sd: number | null;
  n: number;
}

@Injectable()
export class AnomalyService {
  private readonly logger = new Logger(AnomalyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly devices: DevicesService,
  ) {}

  /** Varre um device em todos os sinais; cria Event para cada anomalia nova. */
  async scanDevice(deviceId: string): Promise<{ deviceId: string; anomalies: number }> {
    await this.devices.findOne(deviceId);
    let count = 0;
    for (const m of METRICS) {
      let rows: BaselineRow[];
      try {
        rows = await this.prisma.$queryRawUnsafe<BaselineRow[]>(
          `WITH ranked AS (
             SELECT ${m.entityCol} AS entity, (${m.valExpr})::float8 AS val, time,
                    row_number() OVER (PARTITION BY ${m.entityCol} ORDER BY time DESC) AS rn
             FROM ${m.table}
             WHERE device_id = $1 AND time > now() - interval '3 hours' ${m.filter}
           )
           SELECT entity,
                  max(val) FILTER (WHERE rn = 1) AS latest,
                  avg(val) FILTER (WHERE rn > 1) AS mean,
                  stddev_pop(val) FILTER (WHERE rn > 1) AS sd,
                  count(*) FILTER (WHERE rn > 1)::int AS n
           FROM ranked GROUP BY entity
           HAVING count(*) FILTER (WHERE rn > 1) >= 8`,
          deviceId,
        );
      } catch {
        continue; // tabela ainda não existe
      }

      for (const r of rows) {
        if (r.latest == null || r.mean == null || !r.sd || r.sd <= 0) continue;
        const z = (Number(r.latest) - Number(r.mean)) / Number(r.sd);
        if (Math.abs(z) < Z_THRESHOLD) continue;
        if (await this.recentlyFlagged(deviceId, m.key, r.entity)) continue;

        const dir = z > 0 ? 'acima' : 'abaixo';
        const sev = severityOf(z);
        const msg =
          `Anomalia: ${m.label} de ${r.entity} ${dir} da curva ` +
          `(${Number(r.latest).toFixed(1)}${m.unit}, baseline ${Number(r.mean).toFixed(1)}${m.unit}, z=${z.toFixed(1)})`;
        await this.prisma.event.create({
          data: { deviceId, severity: sev, type: 'anomaly', message: msg, ts: new Date() },
        });
        count++;
      }
    }
    if (count) this.logger.log(`device ${deviceId}: ${count} anomalia(s)`);
    return { deviceId, anomalies: count };
  }

  /** Evita duplicar a mesma anomalia: já houve Event para esse sinal/entidade em 30 min? */
  private async recentlyFlagged(deviceId: string, key: string, entity: string): Promise<boolean> {
    const since = new Date(Date.now() - 30 * 60_000);
    const found = await this.prisma.event.findFirst({
      where: {
        deviceId,
        type: 'anomaly',
        ts: { gt: since },
        message: { contains: ` de ${entity} ` },
      },
      select: { id: true },
    });
    return Boolean(found);
  }

  /** Varre todos os devices (usado pelo scheduler). */
  async scanAll(): Promise<void> {
    const devices = await this.prisma.device.findMany({ select: { id: true } });
    for (const { id } of devices) {
      try {
        await this.scanDevice(id);
      } catch (err) {
        this.logger.warn(`scan do device ${id} falhou: ${String(err)}`);
      }
    }
  }
}

function severityOf(z: number): Severity {
  const a = Math.abs(z);
  if (a >= 5) return 'critical';
  if (a >= 4) return 'error';
  return 'warning';
}
