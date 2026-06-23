import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Licensee } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

/**
 * Faturamento dos licenciados (lado NetX). Fatura mensal = contratos ativos no
 * período × preço por contrato. Geração e marcação de vencidas são cron; o
 * BLOQUEIO em si é calculado ao vivo no heartbeat via `isDelinquent` (não há
 * cron mutando status de instância).
 *
 * Dias de graça antes de considerar inadimplente: LICENSE_GRACE_DAYS (default 2)
 * — alinha com a janela de graça do token.
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(private readonly prisma: PrismaService) {}

  private graceDays(): number {
    return Number(process.env.LICENSE_GRACE_DAYS ?? 2);
  }

  // ── Geração mensal ──────────────────────────────────────────────────────────
  // Todo dia 1 às 03:00: gera a fatura do mês anterior pra cada licenciado com
  // cobrança ativa que ainda não tem fatura daquele período.
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async dailyBillingScan(): Promise<void> {
    const now = new Date();
    // Período = mês anterior (fecha no dia 1).
    const periodStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const periodEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
    // Só roda a geração no começo do mês; nos outros dias só marca vencidas.
    if (now.getDate() <= 2) {
      const licensees = await this.prisma.licensee.findMany({ where: { billingActive: true } });
      for (const lic of licensees) {
        try {
          await this.generateInvoice(lic, periodStart, periodEnd);
        } catch (err) {
          this.logger.warn(`Falha ao gerar fatura de ${lic.name}: ${String(err)}`);
        }
      }
    }
    await this.markOverdue();
  }

  /**
   * Gera (idempotente) a fatura de um período. Base de cálculo: PICO de
   * contratos ativos observado nos heartbeats do período (mais justo que a
   * última leitura — pega o tamanho real da operação no mês).
   */
  async generateInvoice(
    licensee: Licensee,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<{ created: boolean; invoiceId?: string }> {
    const existing = await this.prisma.invoice.findUnique({
      where: { licenseeId_periodStart: { licenseeId: licensee.id, periodStart } },
    });
    if (existing) return { created: false, invoiceId: existing.id };

    const agg = await this.prisma.heartbeatLog.aggregate({
      where: {
        instance: { licenseeId: licensee.id },
        createdAt: { gte: periodStart, lte: periodEnd },
      },
      _max: { activeContracts: true },
    });
    const activeContracts = agg._max.activeContracts ?? 0;
    const unitPriceCents = licensee.pricePerContractCents;
    const amountCents = activeContracts * unitPriceCents;

    // Vencimento: billingDay do mês de emissão (agora).
    const issue = new Date();
    const dueDate = new Date(issue.getFullYear(), issue.getMonth(), licensee.billingDay, 23, 59, 59);

    const inv = await this.prisma.invoice.create({
      data: {
        licenseeId: licensee.id,
        periodStart,
        periodEnd,
        activeContracts,
        unitPriceCents,
        amountCents,
        currency: licensee.currency,
        dueDate,
        status: 'OPEN',
      },
    });
    this.logger.log(
      `Fatura ${inv.id} gerada (${licensee.name}): ${activeContracts}×${unitPriceCents}c = ${amountCents}c`,
    );
    return { created: true, invoiceId: inv.id };
  }

  /** Marca OPEN→OVERDUE quando passou do vencimento + graça. */
  async markOverdue(): Promise<number> {
    const cutoff = new Date(Date.now() - this.graceDays() * 86400 * 1000);
    const res = await this.prisma.invoice.updateMany({
      where: { status: 'OPEN', dueDate: { lt: cutoff } },
      data: { status: 'OVERDUE' },
    });
    if (res.count > 0) this.logger.log(`${res.count} fatura(s) marcada(s) OVERDUE`);
    return res.count;
  }

  // ── Bloqueio por inadimplência (consultado pelo heartbeat) ──────────────────
  /**
   * Licenciado está inadimplente AGORA? = tem fatura OVERDUE (ou OPEN já além
   * do vencimento+graça) E não há desbloqueio em confiança vigente. Cobrança
   * inativa nunca é inadimplente.
   */
  async isDelinquent(licenseeId: string): Promise<boolean> {
    const lic = await this.prisma.licensee.findUnique({ where: { id: licenseeId } });
    if (!lic || !lic.billingActive) return false;

    const cutoff = new Date(Date.now() - this.graceDays() * 86400 * 1000);
    const overdue = await this.prisma.invoice.findFirst({
      where: {
        licenseeId,
        OR: [{ status: 'OVERDUE' }, { status: 'OPEN', dueDate: { lt: cutoff } }],
      },
      select: { id: true },
    });
    if (!overdue) return false;

    // Desbloqueio em confiança vigente cobre a inadimplência.
    const trust = await this.prisma.trustUnlock.findFirst({
      where: { licenseeId, grantedUntil: { gt: new Date() } },
      select: { id: true },
    });
    return !trust;
  }

  // ── Pagamento (baixa) ───────────────────────────────────────────────────────
  /** Marca fatura como paga. method: PIX|CARD|MANUAL; ref opcional (gateway). */
  async markPaid(
    invoiceId: string,
    opts: { method: string; ref?: string; amountCents?: number },
  ): Promise<void> {
    const inv = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!inv) return;
    await this.prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        status: 'PAID',
        paidAt: new Date(),
        paidAmountCents: opts.amountCents ?? inv.amountCents,
        paymentMethod: opts.method,
        paymentRef: opts.ref ?? null,
      },
    });
    this.logger.log(`Fatura ${invoiceId} paga via ${opts.method}`);
  }
}
