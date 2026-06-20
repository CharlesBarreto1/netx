import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  ContractStatus as PrismaContractStatus,
  InvoiceStatus as PrismaInvoiceStatus,
  PaymentMode as PrismaPaymentMode,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { resolveBlockAfterDays } from './billing-period.util';
import { ContractsService } from './contracts.service';
import { InvoiceGeneratorService } from './invoice-generator.service';

/**
 * Tarefa diária do módulo Contratos.
 *
 * 06:00 BRT (cron definido em TZ do host/container — ver README):
 *   1. Gera próximas faturas dentro da janela LEAD_DAYS para contratos ACTIVE.
 *   2. Marca faturas OPEN cuja dueDate passou como OVERDUE.
 *   3. Suspende contratos PREPAID cujo prepaidUntil passou há mais que a
 *      carência (mesmo threshold do pós-pago: contract>plan>5 dias).
 *   4. Suspende contratos POSTPAID com fatura vencida há mais que o threshold
 *      do plano (contract.blockAfterDays ?? plan.blockAfterDays ?? 5).
 *
 * Reativação por pagamento é instantânea (ContractInvoicesService.pay).
 */
@Injectable()
export class OverdueScanService {
  private readonly logger = new Logger(OverdueScanService.name);
  /** Fallback final quando o contrato nem o plano definem blockAfterDays. */
  static readonly DEFAULT_GRACE_DAYS = 5;

  constructor(
    private readonly prisma: PrismaService,
    private readonly contracts: ContractsService,
    private readonly invoiceGen: InvoiceGeneratorService,
  ) {}

  // Todo dia às 06:00 (horário do servidor).
  @Cron('0 6 * * *')
  async handleDailyScan(): Promise<void> {
    this.logger.log('Iniciando rotina diária de contratos (06:00)');
    await this.runOnce();
  }

  /** Exposto para ser chamado manualmente (endpoint admin/testes). */
  async runOnce(now: Date = new Date()): Promise<{
    generated: number;
    markedOverdue: number;
    suspendedPrepaid: number;
    suspended: number;
    trustExpired: number;
  }> {
    const generated = await this.invoiceGen.generateUpcoming(now);
    const markedOverdue = await this.markOverdue(now);
    const trustExpired = await this.expireTrustExtensions(now);
    // Pré-pago: corta quando prepaidUntil < hoje sem nova fatura paga.
    const suspendedPrepaid = await this.suspendExpiredPrepaid(now);
    const suspended = await this.suspendOverdueContracts(now);
    this.logger.log(
      `Rotina diária concluída: generated=${generated}, overdue=${markedOverdue}, ` +
        `trustExpired=${trustExpired}, suspendedPrepaid=${suspendedPrepaid}, suspended=${suspended}`,
    );
    return { generated, markedOverdue, suspendedPrepaid, suspended, trustExpired };
  }

  /**
   * Religue de confiança expirado: contratos ACTIVE com
   * `trustExtensionUntil < hoje` voltam pra SUSPENDED (OVERDUE_PAYMENT).
   * Limpa o `trustExtensionUntil` pra não loopar.
   */
  private async expireTrustExtensions(now: Date): Promise<number> {
    const today = utcMidnight(now);
    const candidates = await this.prisma.contract.findMany({
      where: {
        status: PrismaContractStatus.ACTIVE,
        trustExtensionUntil: { lt: today },
        deletedAt: null,
      },
      select: { id: true, tenantId: true },
    });
    let count = 0;
    for (const c of candidates) {
      try {
        await this.contracts.applySuspend(c.tenantId, c.id, 'OVERDUE_PAYMENT', {
          manual: false,
          note: 'Religue de confiança expirado',
        });
        await this.prisma.contract.update({
          where: { id: c.id },
          data: { trustExtensionUntil: null },
        });
        count++;
      } catch (err) {
        this.logger.error(
          `Falha ao re-suspender contrato ${c.id}: ${(err as Error).message}`,
        );
      }
    }
    return count;
  }

  /** Passa faturas OPEN vencidas para OVERDUE. */
  private async markOverdue(now: Date): Promise<number> {
    const cutoff = utcMidnight(now);
    const res = await this.prisma.contractInvoice.updateMany({
      where: {
        status: PrismaInvoiceStatus.OPEN,
        dueDate: { lt: cutoff },
      },
      data: { status: PrismaInvoiceStatus.OVERDUE },
    });
    return res.count;
  }

  /**
   * Suspende contratos PREPAID cujo período pago (prepaidUntil) acabou há mais
   * que a carência. Aplica o MESMO threshold do pós-pago
   * (contract.blockAfterDays ?? plan.blockAfterDays ?? 5): só corta quando
   * `dias desde prepaidUntil > threshold`, dando N dias de tolerância antes
   * do corte.
   *
   * Idempotente: filtra status=ACTIVE pra não suspender contrato já parado.
   */
  private async suspendExpiredPrepaid(now: Date): Promise<number> {
    const today = utcMidnight(now);
    const candidates = await this.prisma.contract.findMany({
      where: {
        paymentMode: PrismaPaymentMode.PREPAID,
        status: PrismaContractStatus.ACTIVE,
        deletedAt: null,
        prepaidUntil: { lt: today },
        // Respeita religue de confiança ativo: não corta enquanto o prazo vale.
        // (expireTrustExtensions já re-suspende os vencidos antes deste passo.)
        OR: [
          { trustExtensionUntil: null },
          { trustExtensionUntil: { lt: today } },
        ],
      },
      select: {
        id: true,
        tenantId: true,
        prepaidUntil: true,
        blockAfterDays: true,
        plan: { select: { blockAfterDays: true } },
      },
    });
    let count = 0;
    for (const c of candidates) {
      if (!c.prepaidUntil) continue;
      const threshold = resolveBlockAfterDays(
        { blockAfterDays: c.blockAfterDays },
        c.plan ? { blockAfterDays: c.plan.blockAfterDays } : null,
      );
      const expiredDays = Math.floor(
        (today.getTime() - c.prepaidUntil.getTime()) / (24 * 60 * 60 * 1000),
      );
      if (expiredDays <= threshold) continue; // ainda dentro da carência
      try {
        await this.contracts.applySuspend(c.tenantId, c.id, 'OVERDUE_PAYMENT', {
          manual: false,
          note:
            `Suspensão automática: pré-pago expirado em ` +
            `${c.prepaidUntil.toISOString().slice(0, 10)} ` +
            `(há ${expiredDays} dia(s), carência ${threshold})`,
        });
        count++;
      } catch (err) {
        this.logger.error(
          `Falha ao suspender pré-pago ${c.id}: ${(err as Error).message}`,
        );
      }
    }
    return count;
  }

  /**
   * Suspende POSTPAID com fatura OVERDUE há mais que o threshold do plano
   * (override per-contrato ganha). Agrupa por contrato pra não tentar
   * suspender o mesmo várias vezes. Cada contrato pode ter threshold
   * diferente — calculamos o cutoff por contrato.
   */
  private async suspendOverdueContracts(now: Date): Promise<number> {
    const today = utcMidnight(now);

    // Pega TODOS os candidatos POSTPAID com pelo menos 1 fatura OVERDUE,
    // carregando plan.blockAfterDays e contract.blockAfterDays pra calcular
    // o threshold individualmente. Filtragem refinada acontece em memória —
    // volume típico é pequeno (centenas/poucos milhares).
    const candidates = await this.prisma.contract.findMany({
      where: {
        status: PrismaContractStatus.ACTIVE,
        paymentMode: PrismaPaymentMode.POSTPAID,
        deletedAt: null,
        invoices: {
          some: {
            status: PrismaInvoiceStatus.OVERDUE,
            dueDate: { lt: today },
          },
        },
        // Respeita religue de confiança ativo (vide suspendExpiredPrepaid).
        OR: [
          { trustExtensionUntil: null },
          { trustExtensionUntil: { lt: today } },
        ],
      },
      select: {
        id: true,
        tenantId: true,
        blockAfterDays: true,
        plan: { select: { blockAfterDays: true } },
        invoices: {
          where: { status: PrismaInvoiceStatus.OVERDUE },
          select: { dueDate: true },
          orderBy: { dueDate: 'asc' },
          take: 1,
        },
      },
    });

    let suspended = 0;
    for (const c of candidates) {
      const oldest = c.invoices[0];
      if (!oldest) continue;
      const threshold = resolveBlockAfterDays(
        { blockAfterDays: c.blockAfterDays },
        c.plan ? { blockAfterDays: c.plan.blockAfterDays } : null,
      );
      const overdueDays = Math.floor(
        (today.getTime() - oldest.dueDate.getTime()) / (24 * 60 * 60 * 1000),
      );
      if (overdueDays <= threshold) continue;
      try {
        await this.contracts.applySuspend(c.tenantId, c.id, 'OVERDUE_PAYMENT', {
          manual: false,
          note: `Suspensão automática: fatura atrasada há ${overdueDays} dia(s) (threshold=${threshold})`,
        });
        suspended++;
      } catch (err) {
        this.logger.error(
          `Falha ao suspender contrato ${c.id}: ${(err as Error).message}`,
        );
      }
    }
    return suspended;
  }
}

function utcMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
