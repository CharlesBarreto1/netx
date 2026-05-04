import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';

import { CashMovementsService } from './cash-movements.service';
import { CashRegistersController } from './cash-registers.controller';
import { CashRegistersService } from './cash-registers.service';
import { OneTimeChargesController } from './one-time-charges.controller';
import { OneTimeChargesService } from './one-time-charges.service';

/**
 * Módulo Finance — caixas e cobranças avulsas.
 *
 * Endpoints:
 *   /cash-registers                       -> CRUD + add/remove members
 *   /charges                              -> CRUD + pay/cancel
 *
 * Atenção: ContractInvoicesService.pay foi estendido pra aceitar
 * cashRegisterId/discountAmount/paidVia. Ele importa CashRegistersService
 * via re-export aqui.
 */
@Module({
  imports: [AuditModule],
  controllers: [CashRegistersController, OneTimeChargesController],
  providers: [CashRegistersService, OneTimeChargesService, CashMovementsService],
  exports: [CashRegistersService, CashMovementsService],
})
export class FinanceModule {}
