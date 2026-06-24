/**
 * Sync contínuo (read-only) do Hubsoft.
 *
 * A cada hora, para cada tenant com HubsoftConfig.enabled && autoSync, roda o
 * import das entidades habilitadas. Guard de reentrância igual ao EfiAutogen:
 * se um tick ainda roda, o próximo é ignorado. Erros por tenant não derrubam
 * os demais. Nunca escreve no Hubsoft — só lê e espelha no NetX.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PrismaService } from '../prisma/prisma.service';

import { HubsoftConfigService } from './hubsoft-config.service';
import { HubsoftImportService } from './hubsoft-import.service';

@Injectable()
export class HubsoftSyncService {
  private readonly logger = new Logger(HubsoftSyncService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly importer: HubsoftImportService,
    private readonly config: HubsoftConfigService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.runOnce();
    } catch (err) {
      this.logger.error('hubsoft sync tick failed', err as Error);
    } finally {
      this.running = false;
    }
  }

  /** Roda o sync de todos os tenants com autoSync ligado. */
  async runOnce(): Promise<{ tenants: number }> {
    const tenants = await this.prisma.hubsoftConfig.findMany({
      where: { enabled: true, autoSync: true },
      select: { tenantId: true },
    });
    for (const { tenantId } of tenants) {
      try {
        await this.importer.run(tenantId, 'system:hubsoft-sync', { dryRun: false });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`[hubsoft-sync] tenant ${tenantId} falhou: ${message}`);
        await this.config
          .recordSync(tenantId, 'ERROR', null, message)
          .catch(() => undefined);
      }
    }
    if (tenants.length) this.logger.log(`[hubsoft-sync] ${tenants.length} tenant(s) sincronizado(s)`);
    return { tenants: tenants.length };
  }
}
