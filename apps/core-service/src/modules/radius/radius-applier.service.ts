import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma, RadiusAction, RadiusEventStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import {
  POOL_ATIVOS,
  POOL_BLOQUEADOS,
  POOL_CANCELADOS,
} from '../contracts/radius-sync.service';

import { RadiusCoAService } from './radius-coa.service';

/**
 * Consome `radius_events` PENDING e aplica em `radius.radcheck` /
 * `radius.radusergroup`, disparando CoA quando necessário.
 *
 * Roda a cada 15s via cron. Também exposto via `runOnce()` para trigger manual
 * (ex.: logo após `enqueueSync`, para latência próxima de zero).
 */
@Injectable()
export class RadiusApplierService {
  private readonly logger = new Logger(RadiusApplierService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly coa: RadiusCoAService,
  ) {}

  @Cron(CronExpression.EVERY_30_SECONDS)
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.runOnce();
    } catch (err) {
      this.logger.error('applier tick failed', err as Error);
    } finally {
      this.running = false;
    }
  }

  /**
   * Processa até `batchSize` eventos PENDING em ordem cronológica.
   * Idempotente: eventos com falha voltam para `FAILED` com mensagem; podem
   * ser re-enfileirados manualmente (ou pelo job de retry futuro).
   */
  async runOnce(batchSize = 50): Promise<{ processed: number; failed: number }> {
    const events = await this.prisma.radiusEvent.findMany({
      where: { status: RadiusEventStatus.PENDING },
      orderBy: { createdAt: 'asc' },
      take: batchSize,
      include: {
        contract: {
          select: {
            id: true,
            pppoeUsername: true,
            pppoePassword: true,
            status: true,
          },
        },
      },
    });

    if (events.length === 0) return { processed: 0, failed: 0 };

    let processed = 0;
    let failed = 0;
    for (const ev of events) {
      try {
        await this.applyOne(ev);
        processed += 1;
      } catch (err) {
        failed += 1;
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`[RADIUS] event ${ev.id} failed: ${message}`);
        await this.prisma.radiusEvent.update({
          where: { id: ev.id },
          data: {
            status: RadiusEventStatus.FAILED,
            error: message.slice(0, 2000),
          },
        });
      }
    }
    this.logger.log(`[RADIUS] applier batch: processed=${processed} failed=${failed}`);
    return { processed, failed };
  }

  // ---------------------------------------------------------------------------
  // Aplicação por evento
  // ---------------------------------------------------------------------------
  private async applyOne(ev: {
    id: string;
    action: RadiusAction;
    pppoeUsername: string;
    targetPool: string | null;
    contract: {
      id: string;
      pppoeUsername: string;
      pppoePassword: string;
      status: string;
    } | null;
  }): Promise<void> {
    const user = ev.pppoeUsername;

    switch (ev.action) {
      case RadiusAction.AUTHORIZE: {
        if (!ev.contract) throw new Error('contract not found for AUTHORIZE');
        await this.upsertCredentials(user, ev.contract.pppoePassword);
        await this.putInGroup(user, POOL_ATIVOS);
        // CoA pra derrubar sessão antiga se houver (pool mudou)
        await this.coa.disconnect(user);
        break;
      }
      case RadiusAction.BLOCK: {
        await this.putInGroup(user, POOL_BLOQUEADOS);
        await this.coa.disconnect(user);
        break;
      }
      case RadiusAction.CANCEL: {
        await this.putInGroup(user, POOL_CANCELADOS);
        // Também tira a senha para garantir que não autentica mais mesmo se o
        // grupo for alterado manualmente
        await this.deleteCredentials(user);
        await this.coa.disconnect(user);
        break;
      }
      case RadiusAction.DISCONNECT: {
        await this.coa.disconnect(user);
        break;
      }
      default: {
        // exaustivo
        throw new Error(`ação RADIUS desconhecida: ${ev.action}`);
      }
    }

    await this.prisma.radiusEvent.update({
      where: { id: ev.id },
      data: {
        status: RadiusEventStatus.APPLIED,
        appliedAt: new Date(),
        error: null,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Helpers SQL (Prisma raw em schema `radius`)
  // ---------------------------------------------------------------------------

  /** UPSERT radcheck: Cleartext-Password := <password> */
  private async upsertCredentials(username: string, password: string): Promise<void> {
    await this.prisma.$executeRaw(Prisma.sql`
      DELETE FROM radius.radcheck
       WHERE username = ${username} AND attribute = 'Cleartext-Password'
    `);
    await this.prisma.$executeRaw(Prisma.sql`
      INSERT INTO radius.radcheck (username, attribute, op, value)
      VALUES (${username}, 'Cleartext-Password', ':=', ${password})
    `);
  }

  private async deleteCredentials(username: string): Promise<void> {
    await this.prisma.$executeRaw(Prisma.sql`
      DELETE FROM radius.radcheck WHERE username = ${username}
    `);
  }

  /** Garante que `username` esteja SOMENTE no `groupname` dado, com priority=1. */
  private async putInGroup(username: string, groupname: string): Promise<void> {
    await this.prisma.$executeRaw(Prisma.sql`
      DELETE FROM radius.radusergroup WHERE username = ${username}
    `);
    await this.prisma.$executeRaw(Prisma.sql`
      INSERT INTO radius.radusergroup (username, groupname, priority)
      VALUES (${username}, ${groupname}, 1)
    `);
  }
}
