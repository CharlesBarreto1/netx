/**
 * Sync periódico (read-only) do Hubsoft — 4x/dia (a cada 6h: 00/06/12/18h).
 *
 * Para cada tenant com HubsoftConfig.enabled && autoSync, RE-SINCRONIZA apenas
 * os clientes JÁ importados no NetX (onlyImported) — mantém a base migrada
 * atualizada sem puxar clientes novos (a importação de novos é manual, pela
 * lista). Guard de reentrância igual ao EfiAutogen. Nunca escreve no Hubsoft.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

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

  // 4x/dia: 00:00, 06:00, 12:00, 18:00 (segundo minuto hora ...).
  @Cron('0 0 */6 * * *')
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
        await this.importer.run(tenantId, 'system:hubsoft-sync', {
          dryRun: false,
          onlyImported: true,
        });
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
