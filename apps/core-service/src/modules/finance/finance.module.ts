import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';

import { CashMovementsService } from './cash-movements.service';
import { CashRegistersController } from './cash-registers.controller';
import { CashRegistersService } from './cash-registers.service';
import { OneTimeChargesController } from './one-time-charges.controller';
import { OneTimeChargesService } from './one-time-charges.service';
import { SupplierPayablesController } from './supplier-payables.controller';
import { SupplierPayablesService } from './supplier-payables.service';

/**
 * Módulo Finance — caixas, cobranças avulsas e contas a pagar.
 *
 * Endpoints:
 *   /cash-registers                       -> CRUD + add/remove members
 *   /charges                              -> CRUD + pay/cancel
 *   /finance/payables                     -> contas a pagar: list/pay/unpay
 *                                            (parcelas nascem da compra de estoque)
 *
 * Atenção: ContractInvoicesService.pay foi estendido pra aceitar
 * cashRegisterId/discountAmount/paidVia. Ele importa CashRegistersService
 * via re-export aqui.
 */
@Module({
  imports: [AuditModule],
  controllers: [
    CashRegistersController,
    OneTimeChargesController,
    SupplierPayablesController,
  ],
  providers: [
    CashRegistersService,
    OneTimeChargesService,
    CashMovementsService,
    SupplierPayablesService,
  ],
  exports: [CashRegistersService, CashMovementsService, SupplierPayablesService],
})
export class FinanceModule {}
