/**
 * Poller das ordens Ufinet. Mesmo padrão do RadiusApplierService: cron a cada
 * 30s, guard de reentrância, processa um lote de serviços em estado transiente
 * cujo `nextAttemptAt` já venceu, delegando cada um pro UfinetOrdersService.
 *
 * Idempotente: `advance()` trata seu próprio erro/backoff por linha, então uma
 * falha não derruba o lote.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { UfinetLifecycle } from '@prisma/client';
import { UFINET_TRANSIENT_LIFECYCLES } from '@netx/shared';

import { PrismaService } from '../prisma/prisma.service';

import { UfinetHealthService } from './ufinet-health.service';
import { UfinetOrdersService } from './ufinet-orders.service';

const TRANSIENT = [...UFINET_TRANSIENT_LIFECYCLES] as UfinetLifecycle[];

@Injectable()
export class UfinetPollerService {
  private readonly logger = new Logger(UfinetPollerService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: UfinetOrdersService,
    private readonly health: UfinetHealthService,
  ) {}

  @Cron(CronExpression.EVERY_30_SECONDS)
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.runOnce();
    } catch (err) {
      this.logger.error('ufinet poller tick failed', err as Error);
    } finally {
      this.running = false;
    }
  }

  /** Processa até `batchSize` serviços transientes prontos pra avançar. */
  async runOnce(batchSize = 20): Promise<{ processed: number }> {
    // Ufinet indisponível (circuit breaker aberto): MODO SONDA — uma única
    // tentativa por ciclo (ignora o backoff individual) só pra detectar que
    // voltou. Para de martelar com o lote inteiro. O primeiro sucesso fecha o
    // circuito (recordSuccess) e o próximo ciclo retoma o lote normal — os
    // serviços retomam do estado em que estavam (nenhum virou FAILED).
    if (this.health.isDegraded()) {
      const probe = await this.prisma.ufinetService.findFirst({
        where: { lifecycle: { in: TRANSIENT } },
        orderBy: [{ nextAttemptAt: 'asc' }],
      });
      if (!probe) return { processed: 0 };
      try {
        await this.orders.advance(probe);
      } catch (err) {
        this.logger.error(`[ufinet] sonda ${probe.id} falhou: ${(err as Error).message}`);
      }
      this.logger.warn(
        this.health.isDegraded()
          ? '[ufinet] Ufinet indisponível — modo sonda (1 req/ciclo) até recuperar'
          : '[ufinet] Ufinet recuperou — retomando lote normal no próximo ciclo',
      );
      return { processed: 1 };
    }

    const now = new Date();
    const services = await this.prisma.ufinetService.findMany({
      where: {
        lifecycle: { in: TRANSIENT },
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
      },
      orderBy: [{ nextAttemptAt: 'asc' }],
      take: batchSize,
    });
    if (services.length === 0) return { processed: 0 };

    let processed = 0;
    for (const svc of services) {
      try {
        await this.orders.advance(svc);
        processed += 1;
      } catch (err) {
        this.logger.error(`[ufinet] advance ${svc.id} falhou: ${(err as Error).message}`);
      }
      // Se a Ufinet caiu no meio do lote, para o resto: o próximo ciclo entra
      // em modo sonda em vez de martelar os serviços restantes.
      if (this.health.isDegraded()) {
        this.logger.warn('[ufinet] Ufinet caiu no meio do lote — interrompendo, modo sonda a seguir');
        break;
      }
    }
    this.logger.log(`[ufinet] poller: ${processed}/${services.length} avançados`);
    return { processed };
  }
}
