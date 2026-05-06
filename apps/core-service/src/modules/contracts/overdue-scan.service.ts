import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  ContractStatus as PrismaContractStatus,
  InvoiceStatus as PrismaInvoiceStatus,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { ContractsService } from './contracts.service';
import { InvoiceGeneratorService } from './invoice-generator.service';

/**
 * Tarefa diária do módulo Contratos.
 *
 * 06:00 BRT (cron definido em TZ do host/container — ver README):
 *   1. Gera próximas faturas dentro da janela LEAD_DAYS para contratos ACTIVE.
 *   2. Marca faturas OPEN cuja dueDate passou como OVERDUE.
 *   3. Para cada contrato ACTIVE com pelo menos 1 fatura vencida há > 5 dias,
 *      suspende automaticamente com reason=OVERDUE_PAYMENT.
 *
 * A reativação por pagamento é instantânea (ver ContractInvoicesService.pay).
 */
@Injectable()
export class OverdueScanService {
  private readonly logger = new Logger(OverdueScanService.name);
  static readonly OVERDUE_GRACE_DAYS = 5;

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
    suspended: number;
    trustExpired: number;
  }> {
    const generated = await this.invoiceGen.generateUpcoming(now);
    const markedOverdue = await this.markOverdue(now);
    // Religue de confiança expirou? Re-suspende ANTES do scan normal pra
    // que o contrato volte ao pool inadimplente no mesmo ciclo.
    const trustExpired = await this.expireTrustExtensions(now);
    const suspended = await this.suspendOverdueContracts(now);
    this.logger.log(
      `Rotina diária concluída: generated=${generated}, overdue=${markedOverdue}, trustExpired=${trustExpired}, suspended=${suspended}`,
    );
    return { generated, markedOverdue, suspended, trustExpired };
  }

  /**
   * Religue de confiança expirado: contratos ACTIVE com
   * `trustExtensionUntil < hoje` voltam pra SUSPENDED (OVERDUE_PAYMENT).
   * Limpa o `trustExtensionUntil` pra não loopar.
   */
  private async expireTrustExtensions(now: Date): Promise<number> {
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
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
        // Limpa o flag — sem isso, o status vai oscilar.
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
    const cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
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
   * Suspende automaticamente contratos ACTIVE com fatura atrasada > GRACE_DAYS.
   * Agrupa por contrato, para evitar suspender o mesmo contrato várias vezes.
   */
  private async suspendOverdueContracts(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime());
    cutoff.setUTCDate(cutoff.getUTCDate() - OverdueScanService.OVERDUE_GRACE_DAYS);

    const offenders = await this.prisma.contractInvoice.findMany({
      where: {
        status: PrismaInvoiceStatus.OVERDUE,
        dueDate: { lt: cutoff },
        contract: { status: PrismaContractStatus.ACTIVE, deletedAt: null },
      },
      select: { contractId: true, tenantId: true },
      distinct: ['contractId'],
    });

    let suspended = 0;
    for (const row of offenders) {
      try {
        await this.contracts.applySuspend(row.tenantId, row.contractId, 'OVERDUE_PAYMENT', {
          manual: false,
          note: `Suspensão automática: fatura atrasada há mais de ${OverdueScanService.OVERDUE_GRACE_DAYS} dias`,
        });
        suspended++;
      } catch (err) {
        this.logger.error(
          `Falha ao suspender contrato ${row.contractId}: ${(err as Error).message}`,
        );
      }
    }
    return suspended;
  }
}
