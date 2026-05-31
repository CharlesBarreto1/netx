/**
 * Geração automática de cobranças EFI.
 *
 * Cron a cada 5 min (mesmo padrão de guard de reentrância do UfinetPoller):
 * para cada tenant com EfiConfig.enabled && autoGenerate, varre faturas
 * cobráveis (OPEN/OVERDUE, amount > 0) que ainda NÃO têm cobrança EFI em
 * estado PENDING/ACTIVE/PAID e emite uma (kind = defaultChargeKind).
 *
 * Idempotência: a checagem "já existe charge não-cancelada/não-erro" evita
 * duplicar. createForInvoice() trata o próprio erro por linha (marca a charge
 * como ERROR), então uma falha não derruba o lote.
 *
 * Só emite para faturas vencendo dentro de LEAD_DAYS — não adianta gerar um
 * Pix/boleto meses antes do vencimento (a cobrança expiraria antes).
 */
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  EfiChargeStatus as PrismaEfiChargeStatus,
  InvoiceStatus as PrismaInvoiceStatus,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

import { EfiChargesService } from './efi-charges.service';

@Injectable()
export class EfiAutogenService {
  private readonly logger = new Logger(EfiAutogenService.name);
  private running = false;
  /** Gera cobrança quando a fatura vence dentro desta janela. */
  static readonly LEAD_DAYS = 10;

  constructor(
    private readonly prisma: PrismaService,
    private readonly charges: EfiChargesService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.runOnce();
    } catch (err) {
      this.logger.error('efi autogen tick failed', err as Error);
    } finally {
      this.running = false;
    }
  }

  /** Emite cobranças pendentes. Retorna quantas foram criadas. */
  async runOnce(now: Date = new Date(), perTenantLimit = 100): Promise<{ created: number }> {
    const tenants = await this.prisma.efiConfig.findMany({
      where: { enabled: true, autoGenerate: true },
      select: { tenantId: true },
    });
    if (tenants.length === 0) return { created: 0 };

    const limitDate = new Date(now.getTime());
    limitDate.setUTCDate(limitDate.getUTCDate() + EfiAutogenService.LEAD_DAYS);

    let created = 0;
    for (const { tenantId } of tenants) {
      const invoices = await this.prisma.contractInvoice.findMany({
        where: {
          tenantId,
          status: { in: [PrismaInvoiceStatus.OPEN, PrismaInvoiceStatus.OVERDUE] },
          dueDate: { lte: limitDate },
          amount: { gt: 0 },
          // Nenhuma cobrança ainda viva (PENDING/ACTIVE/PAID) — só CANCELED/ERROR
          // não contam, permitindo reemissão futura.
          efiCharges: {
            none: {
              status: {
                in: [
                  PrismaEfiChargeStatus.PENDING,
                  PrismaEfiChargeStatus.ACTIVE,
                  PrismaEfiChargeStatus.PAID,
                ],
              },
            },
          },
        },
        select: { id: true },
        take: perTenantLimit,
        orderBy: { dueDate: 'asc' },
      });

      for (const inv of invoices) {
        try {
          await this.charges.createForInvoice(tenantId, 'system:efi-autogen', inv.id, {});
          created += 1;
        } catch (err) {
          // createForInvoice já marca a charge como ERROR e loga; aqui só
          // garantimos que uma falha não interrompe o lote.
          this.logger.warn(
            `[efi-autogen] fatura ${inv.id} (tenant ${tenantId}) falhou: ${(err as Error).message}`,
          );
        }
      }
    }
    if (created > 0) this.logger.log(`[efi-autogen] ${created} cobrança(s) emitida(s)`);
    return { created };
  }
}
