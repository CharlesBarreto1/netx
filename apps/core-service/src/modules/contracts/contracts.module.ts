import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { BrBillingModule } from '../br-billing/br-billing.module';
import { DisconnectModule } from '../disconnect/disconnect.module';
import { FinanceModule } from '../finance/finance.module';
import { RadiusModule } from '../radius/radius.module';
import { UfinetModule } from '../ufinet/ufinet.module';

import { ContractsController } from './contracts.controller';
import { ContractsService } from './contracts.service';
import { ContractInvoicesController } from './contract-invoices.controller';
import { ContractInvoicesService } from './contract-invoices.service';
import { InvoiceGeneratorService } from './invoice-generator.service';
import { OverdueScanService } from './overdue-scan.service';
import { PlansController } from './plans.controller';
import { PlansService } from './plans.service';
import { RadiusSyncService } from './radius-sync.service';

/**
 * Módulo 03 — Contratos (básico)
 *
 * Endpoints:
 *   /contracts                     -> CRUD + suspend/reactivate/cancel
 *   /contracts/:id/invoices        -> listagem/criação aninhada
 *   /contract-invoices             -> listagem global
 *   /contract-invoices/:id/pay     -> baixa (reativa contrato se estava bloqueado por inadimplência)
 *   /contract-invoices/:id/cancel  -> cancelar fatura
 *   /contracts/_tasks/run-overdue-scan -> rodar cron manualmente (admin)
 *
 * Cron diário (06:00): gera próximas faturas e suspende contratos c/ fatura > 5 dias.
 */
@Module({
  imports: [AuditModule, BrBillingModule, FinanceModule, RadiusModule, DisconnectModule, UfinetModule],
  controllers: [ContractsController, ContractInvoicesController, PlansController],
  providers: [
    ContractsService,
    ContractInvoicesService,
    InvoiceGeneratorService,
    OverdueScanService,
    PlansService,
    RadiusSyncService,
  ],
  exports: [
    ContractsService,
    ContractInvoicesService,
    InvoiceGeneratorService,
    RadiusSyncService,
  ],
})
export class ContractsModule {}
