import { Injectable, Logger } from '@nestjs/common';
import {
  InvoiceKind,
  InvoiceStatus,
  PaymentMode,
  type Contract,
  type Prisma,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import {
  advanceOneMonth,
  daysBetween,
  InvoiceReference,
  nextDueDateFor,
  nextPrepaidDate,
  prorate,
} from './billing-period.util';

/**
 * Geração automática de faturas.
 *
 * Modelos:
 *  - POSTPAID (default histórico): fatura no dueDay do mês. Primeira é
 *    pro-rata se ativou fora do dueDay (cobre activatedAt → nextDueDate).
 *    Cron diário garante a próxima estar gerada dentro de LEAD_DAYS.
 *  - PREPAID: cliente paga antes de usar. Primeira INITIAL vence HOJE.
 *    Quando o pagamento é registrado (vide ContractInvoicesService.pay)
 *    o sistema avança `prepaidUntil` 1 mês. Cron olha pra `prepaidUntil`
 *    e enfileira REGULAR na janela LEAD_DAYS.
 *
 * Idempotente: chave unicidade lógica é (contractId, reference). Reference
 * varia por tipo (mensal, inicial, ajuste de plano) — vide InvoiceReference.
 */
@Injectable()
export class InvoiceGeneratorService {
  private readonly logger = new Logger(InvoiceGeneratorService.name);
  /** Gera próximas faturas quando dueDate cair dentro desta janela. */
  static readonly LEAD_DAYS = 15;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Cria a primeira fatura de um contrato recém-criado/ativado.
   * Chamada dentro de uma transaction — o contrato já foi inserido/atualizado.
   *
   * POSTPAID:
   *   - Calcula nextDueDate(dueDay).
   *   - Se activatedAt cai antes do próximo dueDay (caso normal), gera INITIAL
   *     pro-rata cobrindo [activatedAt, nextDueDate). DueDate = nextDueDate.
   *   - Se activatedAt == nextDueDate (edge), gera INITIAL cheia.
   *
   * PREPAID:
   *   - Gera INITIAL cheia vencendo HOJE (data de ativação).
   *   - Atualiza o próprio contract: prepaidUntil = activatedAt + 1 mês,
   *     cycleAnchorDay = activatedAt.getDate().
   *   - Caller pode pular o pagamento — operador marca PAID manualmente
   *     conforme política da operação (decisão do owner 2026-05-22).
   */
  async generateInitialInvoice(
    tx: Prisma.TransactionClient,
    contract: Pick<
      Contract,
      | 'id'
      | 'tenantId'
      | 'monthlyValue'
      | 'dueDay'
      | 'paymentMode'
      | 'activatedAt'
    >,
    opts?: { firstDueDate?: Date; activatedAt?: Date },
  ): Promise<void> {
    const now = opts?.activatedAt ?? contract.activatedAt ?? new Date();

    if (contract.paymentMode === PaymentMode.PREPAID) {
      const due = utcMidnight(now);
      const periodEnd = nextPrepaidDate(due, 1);
      await tx.contractInvoice.create({
        data: {
          tenantId: contract.tenantId,
          contractId: contract.id,
          amount: contract.monthlyValue,
          dueDate: due,
          kind: InvoiceKind.INITIAL,
          periodStart: due,
          periodEnd,
          status: InvoiceStatus.OPEN,
          reference: InvoiceReference.initialPrepaid(due),
        },
      });
      await tx.contract.update({
        where: { id: contract.id },
        data: {
          // Cycle anchor é estável: dia do mês da ativação. Clamp 28/fev é
          // tratado em nextPrepaidDate.
          cycleAnchorDay: due.getUTCDate(),
          // prepaidUntil só avança QUANDO a fatura é paga (vide
          // ContractInvoicesService.pay). Inicializamos com a data prevista
          // pra simplificar o cron de geração — se ficar OVERDUE, OverdueScan
          // suspende.
          prepaidUntil: periodEnd,
        },
      });
      return;
    }

    // POSTPAID
    const due = opts?.firstDueDate
      ? utcMidnight(opts.firstDueDate)
      : nextDueDateFor(contract.dueDay, now);
    const periodStart = utcMidnight(now);
    const isProrata = periodStart < due;
    const totalDays = daysBetween(
      // ciclo anterior = due - 1 mês (aproximado). Pra prorate basta saber
      // a base do mês cobrado pra calcular a fração — usamos os dias entre
      // activatedAt e dueDate como numerador, e dias do mês cobrado como
      // denominador. Aproximação clássica de pro-rata pacotes recorrentes.
      previousMonth(due),
      due,
    );
    const days = daysBetween(periodStart, due);
    const amount = isProrata
      ? prorate(contract.monthlyValue, days, totalDays)
      : contract.monthlyValue;

    await tx.contractInvoice.create({
      data: {
        tenantId: contract.tenantId,
        contractId: contract.id,
        amount,
        dueDate: due,
        kind: InvoiceKind.INITIAL,
        periodStart,
        periodEnd: due,
        status: InvoiceStatus.OPEN,
        reference: InvoiceReference.initialPostpaid(due),
      },
    });
  }

  /**
   * Cron diário (chamado por OverdueScanService.runOnce):
   * Para cada contrato ACTIVE, garante que a próxima fatura esteja gerada
   * dentro de LEAD_DAYS. Idempotente por (contractId, reference).
   *
   * POSTPAID: olha última fatura, avança 1 mês.
   * PREPAID:  olha prepaidUntil — se entra na janela, gera REGULAR vencendo
   *           no prepaidUntil atual (próxima cobrança).
   */
  async generateUpcoming(now: Date = new Date()): Promise<number> {
    const limitDate = new Date(now.getTime());
    limitDate.setUTCDate(limitDate.getUTCDate() + InvoiceGeneratorService.LEAD_DAYS);

    const contracts = await this.prisma.contract.findMany({
      where: { status: 'ACTIVE', deletedAt: null },
      include: {
        invoices: {
          orderBy: { dueDate: 'desc' },
          take: 1,
        },
      },
    });

    let created = 0;
    for (const c of contracts) {
      if (c.paymentMode === PaymentMode.PREPAID) {
        // PREPAID: próximo vencimento = prepaidUntil. Se ainda não tem,
        // pula (deveria ter sido inicializado em generateInitialInvoice).
        if (!c.prepaidUntil) continue;
        const nextDue = utcMidnight(c.prepaidUntil);
        if (nextDue > limitDate) continue;

        const periodStart = nextDue;
        const periodEnd = nextPrepaidDate(periodStart, 1);
        const reference = InvoiceReference.initialPrepaid(nextDue);

        const exists = await this.prisma.contractInvoice.findFirst({
          where: { tenantId: c.tenantId, contractId: c.id, reference },
          select: { id: true },
        });
        if (exists) continue;

        await this.prisma.contractInvoice.create({
          data: {
            tenantId: c.tenantId,
            contractId: c.id,
            amount: c.monthlyValue,
            dueDate: nextDue,
            kind: InvoiceKind.REGULAR,
            periodStart,
            periodEnd,
            status: InvoiceStatus.OPEN,
            reference,
          },
        });
        created++;
        continue;
      }

      // POSTPAID
      const last = c.invoices[0];
      let nextDue: Date;
      if (!last) {
        nextDue = nextDueDateFor(c.dueDay, now);
      } else {
        nextDue = advanceOneMonth(last.dueDate);
      }
      if (nextDue > limitDate) continue;

      const reference = InvoiceReference.regular(nextDue);
      const exists = await this.prisma.contractInvoice.findFirst({
        where: { tenantId: c.tenantId, contractId: c.id, reference },
        select: { id: true },
      });
      if (exists) continue;

      const periodEnd = nextDue;
      const periodStart = previousMonth(nextDue);
      await this.prisma.contractInvoice.create({
        data: {
          tenantId: c.tenantId,
          contractId: c.id,
          amount: c.monthlyValue,
          dueDate: nextDue,
          kind: InvoiceKind.REGULAR,
          periodStart,
          periodEnd,
          status: InvoiceStatus.OPEN,
          reference,
        },
      });
      created++;
    }
    if (created > 0) {
      this.logger.log(
        `Geradas ${created} faturas futuras (lead=${InvoiceGeneratorService.LEAD_DAYS}d)`,
      );
    }
    return created;
  }
}

function utcMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function previousMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, d.getUTCDate()));
}
