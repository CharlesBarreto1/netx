/**
 * NetworkSnapshotService — amostragem periódica do estado da rede.
 *
 * Grava, por tenant, quantas sessões RADIUS estavam ativas e quanto tráfego a
 * frota movia naquele instante. É a MEMÓRIA do painel: sem ela, "caíram vários
 * PPPoE" e "queda/subida brusca de tráfego" não são detectáveis, porque não há
 * baseline contra o qual comparar o agora.
 *
 * Frequência: `NMS_SNAPSHOT_CRON` (default 5 min). Cinco minutos é o meio-termo
 * deliberado — a contagem de sessões cruza `contracts × radius.radacct`, que é
 * cara (o próprio endpoint do dashboard pede refresh de 30 min pra não martelar
 * o banco); amostrar de minuto em minuto multiplicaria esse custo por cinco sem
 * ganho real, já que uma queda em massa de PPPoE leva minutos pra se
 * materializar de qualquer forma.
 *
 * Retenção: `NMS_SNAPSHOT_RETENTION_DAYS` (default 30). Poda no fim de cada
 * ciclo — sem isto a tabela cresceria pra sempre num Postgres que não tem
 * política de retenção nativa (não é hypertable).
 */
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PrismaService } from '../prisma/prisma.service';
import { RadacctService } from '../radius/radacct.service';
import { NmsClientService } from './nms-client.service';

/** Desliga o coletor (ex.: réplica de leitura, ambiente de teste). */
const ENABLED = (process.env.NMS_SNAPSHOT_ENABLED ?? '1') !== '0';
/** Dias de histórico mantidos. Além disto, poda. */
const RETENTION_DAYS = parseInt(process.env.NMS_SNAPSHOT_RETENTION_DAYS ?? '30', 10);

@Injectable()
export class NetworkSnapshotService {
  private readonly logger = new Logger(NetworkSnapshotService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly radacct: RadacctService,
    private readonly nms: NmsClientService,
  ) {}

  /**
   * Um tick: amostra todos os tenants ativos e poda o histórico velho.
   *
   * O cron é fixo em 5 min (CronExpression) em vez de env: o @Cron do Nest
   * exige expressão estática em decorator, e a janela do baseline no
   * NmsDashboardService assume esta cadência pra converter "N amostras" em
   * minutos.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async tick(): Promise<void> {
    if (!ENABLED) return;
    const tenants = await this.prisma.tenant.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, slug: true },
    });

    // O `/summary` do NMS é global (o NMS é single-tenant por instalação),
    // então busca UMA vez e carimba em todos os tenants — N chamadas HTTP
    // devolveriam exatamente o mesmo payload.
    const fleet = await this.nms.fleetSummary();

    for (const t of tenants) {
      try {
        await this.captureTenant(t.id, fleet);
      } catch (err) {
        // Um tenant com problema não pode impedir a amostragem dos outros:
        // buracos no histórico de todo mundo por causa de um só seriam pior.
        this.logger.warn(`snapshot do tenant ${t.slug} falhou: ${String(err)}`);
      }
    }

    await this.prune().catch((err) => this.logger.warn(`poda falhou: ${String(err)}`));
  }

  /** Grava uma amostra do tenant. Exposto pra teste e pra coleta sob demanda. */
  async captureTenant(
    tenantId: string,
    fleet: Awaited<ReturnType<NmsClientService['fleetSummary']>>,
  ): Promise<void> {
    const online = await this.radacct.getOnlineSnapshot(tenantId);

    await this.prisma.networkSnapshot.create({
      data: {
        tenantId,
        activeSessions: online.online,
        activeContracts: online.totalActive,
        // Ausência do NMS grava NULL, não 0 — ver NmsClientService.
        totalInBps: fleet ? BigInt(Math.round(fleet.totalInBps)) : null,
        totalOutBps: fleet ? BigInt(Math.round(fleet.totalOutBps)) : null,
        devicesOnline: fleet?.online ?? null,
        devicesTotal: fleet?.deviceCount ?? null,
      },
    });
  }

  /** Apaga amostras além da janela de retenção. */
  private async prune(): Promise<void> {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    await this.prisma.networkSnapshot.deleteMany({ where: { at: { lt: cutoff } } });
  }
}
