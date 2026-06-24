/**
 * Geração automática de cobranças BTG (boleto/Pix) sobre faturas a vencer.
 *
 * Espelha o EfiAutogenService. A escolha de cobrar via BTG é POR CONTRATO
 * (contract.brBillingGateway === 'BTG') — este cron é a REDE DE SEGURANÇA que
 * emite o que o "emit-na-hora" não cobriu (gateway fora no momento, ou fatura
 * gerada pelo cron diário).
 *
 * Cron a cada 5 min com guard de reentrância. Idempotência: só emite p/ faturas
 * cobráveis (OPEN/OVERDUE, amount > 0) sem cobrança BTG viva (PENDING/ACTIVE/PAID).
 */
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  BtgChargeStatus as PrismaBtgChargeStatus,
  InvoiceStatus as PrismaInvoiceStatus,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

import { BtgChargesService } from './btg-charges.service';

@Injectable()
export class BtgAutogenService {
  private readonly logger = new Logger(BtgAutogenService.name);
  private running = false;
  static readonly LEAD_DAYS = 10;

  constructor(
    private readonly prisma: PrismaService,
    private readonly charges: BtgChargesService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.runOnce();
    } catch (err) {
      this.logger.error('btg autogen tick failed', err as Error);
    } finally {
      this.running = false;
    }
  }

  /** Emite cobranças pendentes. Retorna quantas foram criadas. */
  async runOnce(now: Date = new Date(), perTenantLimit = 100): Promise<{ created: number }> {
    // Tenants com BTG configurado/ligado. A escolha de cobrar via BTG é POR
    // CONTRATO (contract.brBillingGateway), filtrada abaixo.
    const tenants = await this.prisma.btgConfig.findMany({
      where: { enabled: true },
      select: { tenantId: true },
    });
    if (tenants.length === 0) return { created: 0 };

    const limitDate = new Date(now.getTime());
    limitDate.setUTCDate(limitDate.getUTCDate() + BtgAutogenService.LEAD_DAYS);

    let created = 0;
    for (const { tenantId } of tenants) {
      const invoices = await this.prisma.contractInvoice.findMany({
        where: {
          tenantId,
          // Rede de segurança: só faturas de contratos que escolheram BTG.
          contract: { brBillingGateway: 'BTG' },
          status: { in: [PrismaInvoiceStatus.OPEN, PrismaInvoiceStatus.OVERDUE] },
          dueDate: { lte: limitDate },
          amount: { gt: 0 },
          btgCharges: {
            none: {
              status: {
                in: [
                  PrismaBtgChargeStatus.PENDING,
                  PrismaBtgChargeStatus.ACTIVE,
                  PrismaBtgChargeStatus.PAID,
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
          await this.charges.createForInvoice(tenantId, 'system:btg-autogen', inv.id, {});
          created += 1;
        } catch (err) {
          this.logger.warn(
            `[btg-autogen] fatura ${inv.id} (tenant ${tenantId}) falhou: ${(err as Error).message}`,
          );
        }
      }
    }
    if (created > 0) this.logger.log(`[btg-autogen] ${created} cobrança(s) emitida(s)`);
    return { created };
  }
}
