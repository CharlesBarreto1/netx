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
            authMethod: true,
            pppoeUsername: true,
            pppoePassword: true,
            // Campos IPoE necessários pra montar o radreply (Framed-IP).
            framedIpAddress: true,
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
      authMethod: 'PPPOE' | 'IPOE';
      pppoeUsername: string | null;
      pppoePassword: string | null;
      framedIpAddress: string | null;
      status: string;
    } | null;
  }): Promise<void> {
    // Username efetivo no RADIUS = string que vai pra coluna `username` em
    // radcheck/radusergroup. Pra PPPoE é o pppoeUsername; pra IPoE é o
    // circuit-id (ou MAC) que veio gravado em `pppoeUsername` do event.
    const user = ev.pppoeUsername;
    const isIpoe = ev.contract?.authMethod === 'IPOE';

    switch (ev.action) {
      case RadiusAction.AUTHORIZE: {
        if (!ev.contract) throw new Error('contract not found for AUTHORIZE');
        if (isIpoe) {
          // Sem senha: o BNG já confiou no circuit-id/MAC. Marcamos
          // Auth-Type := Accept pra que o FreeRADIUS aceite sem checar
          // senha. Se houver IP fixo, devolve Framed-IP-Address.
          await this.setAcceptAuth(user);
          await this.setFramedIp(user, ev.contract.framedIpAddress);
        } else {
          if (!ev.contract.pppoePassword) {
            throw new Error('PPPoE sem senha — não pode autorizar');
          }
          await this.upsertCredentials(user, ev.contract.pppoePassword);
          await this.clearFramedIp(user); // limpa se tiver legado
        }
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
        // Tira credenciais (senha PPPoE ou Auth-Type IPoE) e Framed-IP pra
        // garantir que não autentica mais mesmo se o grupo for alterado.
        await this.deleteCredentials(user);
        await this.clearFramedIp(user);
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

  /** UPSERT radcheck: Cleartext-Password := <password> (PPPoE) */
  private async upsertCredentials(username: string, password: string): Promise<void> {
    await this.prisma.$executeRaw(Prisma.sql`
      DELETE FROM radius.radcheck
       WHERE username = ${username}
         AND attribute IN ('Cleartext-Password', 'Auth-Type')
    `);
    await this.prisma.$executeRaw(Prisma.sql`
      INSERT INTO radius.radcheck (username, attribute, op, value)
      VALUES (${username}, 'Cleartext-Password', ':=', ${password})
    `);
  }

  /**
   * IPoE: marca Auth-Type := Accept em radcheck pra que o FreeRADIUS aceite
   * o cliente sem checar senha. O ID já foi validado pelo BNG via
   * circuit-id (option 82) ou MAC.
   */
  private async setAcceptAuth(username: string): Promise<void> {
    await this.prisma.$executeRaw(Prisma.sql`
      DELETE FROM radius.radcheck
       WHERE username = ${username}
         AND attribute IN ('Cleartext-Password', 'Auth-Type')
    `);
    await this.prisma.$executeRaw(Prisma.sql`
      INSERT INTO radius.radcheck (username, attribute, op, value)
      VALUES (${username}, 'Auth-Type', ':=', 'Accept')
    `);
  }

  /**
   * Define Framed-IP-Address em radreply quando há IP fixo. Quando ip = null,
   * limpa o atributo (cliente passa a pegar do pool dinâmico).
   */
  private async setFramedIp(username: string, ip: string | null): Promise<void> {
    await this.prisma.$executeRaw(Prisma.sql`
      DELETE FROM radius.radreply
       WHERE username = ${username} AND attribute = 'Framed-IP-Address'
    `);
    if (!ip) return;
    await this.prisma.$executeRaw(Prisma.sql`
      INSERT INTO radius.radreply (username, attribute, op, value)
      VALUES (${username}, 'Framed-IP-Address', ':=', ${ip})
    `);
  }

  private async clearFramedIp(username: string): Promise<void> {
    await this.prisma.$executeRaw(Prisma.sql`
      DELETE FROM radius.radreply
       WHERE username = ${username} AND attribute = 'Framed-IP-Address'
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
