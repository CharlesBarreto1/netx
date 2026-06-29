import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { DevicesService } from '../devices/devices.service.js';

export interface InterfaceRate {
  ifName: string;
  inBps: number | null;
  outBps: number | null;
  inErrors: number | null;
  outErrors: number | null;
  operStatus: number | null;
}
export interface OpticalReading {
  ifName: string;
  rxDbm: number | null;
  txDbm: number | null;
  moduleTempC: number | null;
}
export interface SystemReading {
  component: string;
  tempC: number | null;
  cpuPct: number | null;
}

@Injectable()
export class MetricsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly devices: DevicesService,
  ) {}

  /** Taxa atual por interface (bps), calculada a partir das duas últimas amostras de contadores. */
  async interfaceRates(deviceId: string): Promise<InterfaceRate[]> {
    await this.devices.findOne(deviceId);
    return this.prisma.$queryRawUnsafe<InterfaceRate[]>(
      `WITH recent AS (
         SELECT "ifName", time, "ifHCInOctets", "ifHCOutOctets", "ifInErrors", "ifOutErrors",
                "ifOperStatus",
                lag("ifHCInOctets") OVER w AS prev_in,
                lag("ifHCOutOctets") OVER w AS prev_out,
                lag(time) OVER w AS prev_time
         FROM metrics.snmp_interface
         WHERE device_id = $1 AND time > now() - interval '60 minutes'
         WINDOW w AS (PARTITION BY "ifName" ORDER BY time)
       )
       SELECT DISTINCT ON ("ifName")
         "ifName",
         (CASE WHEN prev_time IS NOT NULL AND "ifHCInOctets" >= prev_in
              THEN ("ifHCInOctets" - prev_in) * 8.0 / NULLIF(extract(epoch FROM (time - prev_time)),0)
         END)::float8 AS "inBps",
         (CASE WHEN prev_time IS NOT NULL AND "ifHCOutOctets" >= prev_out
              THEN ("ifHCOutOctets" - prev_out) * 8.0 / NULLIF(extract(epoch FROM (time - prev_time)),0)
         END)::float8 AS "outBps",
         "ifInErrors"::float AS "inErrors",
         "ifOutErrors"::float AS "outErrors",
         "ifOperStatus"::int AS "operStatus"
       FROM recent
       ORDER BY "ifName", time DESC`,
      deviceId,
    );
  }

  /**
   * Última leitura óptica por interface (RX/TX em dBm). A measurement difere por vendor
   * (Juniper jnxDom → snmp_optical; Mikrotik mtxrOptical → snmp_mikrotik_optical), mas as
   * colunas e a escala (centésimos de dBm) são as mesmas → mesma query, tabela parametrizada.
   */
  async optical(deviceId: string): Promise<OpticalReading[]> {
    const device = await this.devices.findOne(deviceId);
    const table = device.vendor === 'mikrotik' ? 'snmp_mikrotik_optical' : 'snmp_optical';
    return this.prisma.$queryRawUnsafe<OpticalReading[]>(
      `SELECT DISTINCT ON ("ifName")
         "ifName",
         round("rxLaserPower"/100.0, 2)::float8 AS "rxDbm",
         round("txLaserOutputPower"/100.0, 2)::float8 AS "txDbm",
         "moduleTemperature"::int AS "moduleTempC"
       FROM metrics.${table}
       WHERE device_id = $1 AND time > now() - interval '60 minutes' AND "rxLaserPower" <> 0
       ORDER BY "ifName", time DESC`,
      deviceId,
    );
  }

  /** Última leitura de temperatura/CPU por componente, conforme o vendor. */
  async system(deviceId: string): Promise<SystemReading[]> {
    const device = await this.devices.findOne(deviceId);
    if (device.vendor === 'mikrotik') return this.systemMikrotik(deviceId);
    return this.prisma.$queryRawUnsafe<SystemReading[]>(
      `SELECT DISTINCT ON ("jnxOperatingDescr")
         "jnxOperatingDescr" AS component,
         "jnxOperatingTemp"::int AS "tempC",
         "jnxOperatingCPU"::int AS "cpuPct"
       FROM metrics.snmp_juniper_operating
       WHERE device_id = $1 AND time > now() - interval '60 minutes'
       ORDER BY "jnxOperatingDescr", time DESC`,
      deviceId,
    );
  }

  /**
   * Saúde Mikrotik: temp da placa/CPU (mtxrHealth, escalares) + carga média de CPU
   * (HOST-RESOURCES hrProcessorLoad, média dos núcleos). Monta as linhas no TS.
   */
  private async systemMikrotik(deviceId: string): Promise<SystemReading[]> {
    const rows = await this.prisma.$queryRawUnsafe<
      { boardTempC: number | null; cpuTempC: number | null; cpuPct: number | null }[]
    >(
      `SELECT
         (SELECT "boardTempC"::float8 FROM metrics.snmp_mikrotik_health
            WHERE device_id = $1 AND time > now() - interval '60 minutes'
            ORDER BY time DESC LIMIT 1) AS "boardTempC",
         (SELECT "cpuTempC"::float8 FROM metrics.snmp_mikrotik_health
            WHERE device_id = $1 AND time > now() - interval '60 minutes'
            ORDER BY time DESC LIMIT 1) AS "cpuTempC",
         (SELECT round(avg("hrProcessorLoad"))::float8 FROM metrics.snmp_host_resources
            WHERE device_id = $1 AND time > now() - interval '15 minutes') AS "cpuPct"`,
      deviceId,
    );
    const r = rows[0];
    if (!r) return [];
    const out: SystemReading[] = [];
    if (r.boardTempC != null) out.push({ component: 'Placa', tempC: r.boardTempC, cpuPct: r.cpuPct });
    if (r.cpuTempC != null) out.push({ component: 'CPU', tempC: r.cpuTempC, cpuPct: r.cpuPct });
    // Sem sensor de temp (alguns RB): ainda mostra a CPU.
    if (out.length === 0 && r.cpuPct != null) out.push({ component: 'CPU', tempC: null, cpuPct: r.cpuPct });
    return out;
  }
}
