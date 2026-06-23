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

  /** Última leitura óptica por interface (RX/TX em dBm). */
  async optical(deviceId: string): Promise<OpticalReading[]> {
    await this.devices.findOne(deviceId);
    return this.prisma.$queryRawUnsafe<OpticalReading[]>(
      `SELECT DISTINCT ON ("ifName")
         "ifName",
         round("rxLaserPower"/100.0, 2)::float8 AS "rxDbm",
         round("txLaserOutputPower"/100.0, 2)::float8 AS "txDbm",
         "moduleTemperature"::int AS "moduleTempC"
       FROM metrics.snmp_optical
       WHERE device_id = $1 AND time > now() - interval '60 minutes' AND "rxLaserPower" <> 0
       ORDER BY "ifName", time DESC`,
      deviceId,
    );
  }

  /** Última leitura de temperatura/CPU por componente. */
  async system(deviceId: string): Promise<SystemReading[]> {
    await this.devices.findOne(deviceId);
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
}
