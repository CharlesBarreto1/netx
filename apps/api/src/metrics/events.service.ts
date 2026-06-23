import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { DevicesService } from '../devices/devices.service.js';

type Severity = 'info' | 'warning' | 'error' | 'critical';

export interface DeviceEvent {
  ts: Date;
  type: string;
  severity: Severity;
  source: string;
  message: string | null;
}

interface TrapRow {
  ts: Date;
  source: string;
  type: string;
  mib: string | null;
}

/** Severidade derivada do tipo de trap (sem MIB de severidade no MVP). */
function severityOf(type: string): Severity {
  const t = type.toLowerCase();
  if (t.includes('linkdown')) return 'warning';
  if (t.includes('authenticationfailure')) return 'warning';
  if (t.includes('coldstart') || t.includes('warmstart')) return 'info';
  if (t.includes('linkup')) return 'info';
  return 'info';
}

@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly devices: DevicesService,
  ) {}

  /**
   * Eventos do device, unindo traps SNMP (metrics.snmp_trap, casados por IP de origem) e
   * eventos internos da tabela Event (ex.: config-change do backup). Ordenados por tempo.
   */
  async listForDevice(deviceId: string): Promise<DeviceEvent[]> {
    const device = await this.devices.findOne(deviceId);

    let traps: TrapRow[] = [];
    try {
      traps = await this.prisma.$queryRawUnsafe<TrapRow[]>(
        `SELECT time AS ts, source, name AS type, mib
         FROM metrics.snmp_trap
         WHERE source = $1
         ORDER BY time DESC
         LIMIT 100`,
        device.mgmtIp,
      );
    } catch {
      traps = []; // tabela de traps ainda não criada
    }

    const internal = await this.prisma.event.findMany({
      where: { deviceId },
      orderBy: { ts: 'desc' },
      take: 100,
    });

    const fromTraps: DeviceEvent[] = traps.map((r) => ({
      ts: r.ts,
      type: r.type,
      severity: severityOf(r.type),
      source: r.source,
      message: r.mib ? `${r.type} (${r.mib})` : r.type,
    }));
    const fromInternal: DeviceEvent[] = internal.map((e) => ({
      ts: e.ts,
      type: e.type,
      severity: e.severity as Severity,
      source: 'netx-nms',
      message: e.message,
    }));

    return [...fromTraps, ...fromInternal]
      .sort((a, b) => b.ts.getTime() - a.ts.getTime())
      .slice(0, 100);
  }
}
