import { Injectable, Logger } from '@nestjs/common';
import { InvoiceStatus, type Contract, type Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

/**
 * Geração automática de faturas.
 *
 * Regra de negócio (por ora):
 *   - Ao criar um contrato, geramos a PRÓXIMA fatura com dueDate = próximo dia `dueDay`.
 *   - Diariamente (cron), procuramos contratos ACTIVE cuja última fatura tem
 *     dueDate dentro de 15 dias e geramos a fatura do mês seguinte se ainda não existir.
 *
 * Sempre em 1 fatura por mês por contrato. Idempotente (unique por contractId+referencia).
 */
@Injectable()
export class InvoiceGeneratorService {
  private readonly logger = new Logger(InvoiceGeneratorService.name);
  /** Gera próximas faturas quando dueDate cair dentro desta janela. */
  static readonly LEAD_DAYS = 15;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Calcula próxima data de vencimento para um dado `dueDay`:
   *  - Se hoje <= dueDay do mês atual, vence este mês.
   *  - Caso contrário, vence no próximo mês.
   *  - `dueDay` é clamp-ado entre 1 e 28 (validado no DTO), então dias inválidos (ex. 31/02)
   *    não acontecem.
   */
  static nextDueDate(dueDay: number, from = new Date()): Date {
    const base = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
    const todayDay = from.getUTCDate();
    // mês alvo: atual se ainda não passou dueDay; senão próximo
    if (todayDay <= dueDay) {
      return new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), dueDay));
    }
    return new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, dueDay));
  }

  /** Dada uma dueDate, retorna dueDate do MÊS SEGUINTE mantendo o mesmo dia. */
  static advanceOneMonth(current: Date): Date {
    return new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, current.getUTCDate()));
  }

  /** Referência textual canônica para uma fatura: "Mensalidade MM/YYYY". */
  static referenceFor(due: Date): string {
    const mm = String(due.getUTCMonth() + 1).padStart(2, '0');
    return `Mensalidade ${mm}/${due.getUTCFullYear()}`;
  }

  /**
   * Cria a primeira fatura de um contrato recém-criado.
   * Recebe a transaction client — chamado dentro do create do contrato.
   */
  async generateInitialInvoice(
    tx: Prisma.TransactionClient,
    contract: Pick<Contract, 'id' | 'tenantId' | 'monthlyValue' | 'dueDay'>,
    firstDueDate?: Date,
  ): Promise<void> {
    const due = firstDueDate ?? InvoiceGeneratorService.nextDueDate(contract.dueDay);
    await tx.contractInvoice.create({
      data: {
        tenantId: contract.tenantId,
        contractId: contract.id,
        amount: contract.monthlyValue,
        dueDate: due,
        status: InvoiceStatus.OPEN,
        reference: InvoiceGeneratorService.referenceFor(due),
      },
    });
  }

  /**
   * Rotina diária: para cada contrato ACTIVE, garante que a próxima fatura
   * esteja gerada dentro da janela LEAD_DAYS.
   * Retorna quantidade de faturas criadas.
   */
  async generateUpcoming(now: Date = new Date()): Promise<number> {
    const limitDate = new Date(now.getTime());
    limitDate.setUTCDate(limitDate.getUTCDate() + InvoiceGeneratorService.LEAD_DAYS);

    // Contratos ativos com sua última fatura OPEN/PAID cuja dueDate <= limitDate
    // (ou sem nenhuma fatura)
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
      const last = c.invoices[0];
      let nextDue: Date;
      if (!last) {
        nextDue = InvoiceGeneratorService.nextDueDate(c.dueDay, now);
      } else {
        nextDue = InvoiceGeneratorService.advanceOneMonth(last.dueDate);
      }
      if (nextDue > limitDate) continue;

      const reference = InvoiceGeneratorService.referenceFor(nextDue);
      // Idempotência: pula se já existe fatura com mesma reference neste contrato
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
          status: InvoiceStatus.OPEN,
          reference,
        },
      });
      created++;
    }
    if (created > 0) {
      this.logger.log(`Geradas ${created} faturas futuras (lead=${InvoiceGeneratorService.LEAD_DAYS}d)`);
    }
    return created;
  }
}
