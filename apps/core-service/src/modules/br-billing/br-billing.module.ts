import { Module } from '@nestjs/common';

import { BrBillingService } from './br-billing.service';

/**
 * BrBillingModule — dispatcher de cobrança BR por contrato.
 *
 * Não importa EfiModule/BtgModule (eles importam o ContractsModule, e o
 * ContractsModule importa este módulo — importá-los aqui fecharia um ciclo).
 * O BrBillingService resolve os charges services via ModuleRef em runtime.
 * PrismaModule é @Global; ModuleRef é provido pelo core do Nest.
 */
@Module({
  providers: [BrBillingService],
  exports: [BrBillingService],
})
export class BrBillingModule {}
