import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { DevicesService } from './devices.service.js';

type IfStatus = 'up' | 'down' | 'unknown';

interface MetricRow {
  name: string;
  description: string | null;
  oper: number | null;
  admin: number | null;
  mbps: number | null;
}

function status(v: number | null): IfStatus {
  if (v === 1) return 'up';
  if (v === 2) return 'down';
  return 'unknown';
}

@Injectable()
export class DiscoveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly devices: DevicesService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Popula `Interface` a partir do que o Telegraf JÁ coletou em metrics.snmp_interface
   * (última amostra por interface). Mais confiável que um segundo poller e alinhado ao
   * AGENTS.md ("não escreva poller próprio"). Exige que o Telegraf já tenha pollado o device.
   */
  async discover(deviceId: string, actor: string) {
    await this.devices.findOne(deviceId);

    // Descobre quais colunas o Telegraf já materializou: ifAlias/ifHighSpeed só existem após
    // um poll com a config nova. A query se adapta às colunas presentes (nome+status sempre).
    let cols: Array<{ column_name: string }>;
    try {
      cols = await this.prisma.$queryRaw<Array<{ column_name: string }>>`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'metrics' AND table_name = 'snmp_interface'
      `;
    } catch {
      throw new BadRequestException('Coleta SNMP ainda não inicializada para este device');
    }
    const has = (c: string) => cols.some((x) => x.column_name === c);
    if (!has('ifName')) {
      throw new BadRequestException('Sem métricas de interface ainda — aguarde o Telegraf coletar');
    }
    const descExpr = has('ifAlias') ? `NULLIF("ifAlias", '')` : `NULL`;
    const speedExpr = has('ifHighSpeed') ? `"ifHighSpeed"::bigint` : `NULL::bigint`;

    const rows = await this.prisma.$queryRawUnsafe<MetricRow[]>(
      `SELECT DISTINCT ON ("ifName")
         "ifName" AS name,
         ${descExpr} AS description,
         "ifOperStatus"::int AS oper,
         "ifAdminStatus"::int AS admin,
         ${speedExpr} AS mbps
       FROM metrics.snmp_interface
       WHERE device_id = $1
       ORDER BY "ifName", time DESC`,
      deviceId,
    );

    if (rows.length === 0) {
      throw new BadRequestException(
        'Nenhuma interface coletada ainda — confirme a community e aguarde o Telegraf pollar',
      );
    }

    await this.prisma.$transaction(
      rows.map((r) => {
        const data = {
          description: r.description,
          adminStatus: status(r.admin),
          operStatus: status(r.oper),
          speedBps: r.mbps ? BigInt(Number(r.mbps)) * 1_000_000n : null,
        };
        return this.prisma.interface.upsert({
          where: { deviceId_name: { deviceId, name: r.name } },
          create: { deviceId, name: r.name, ...data },
          update: data,
        });
      }),
    );

    await this.audit.record({
      actor,
      deviceId,
      action: 'device.discover-interfaces',
      result: `ok: ${rows.length} interfaces`,
    });
    return { deviceId, count: rows.length };
  }
}
