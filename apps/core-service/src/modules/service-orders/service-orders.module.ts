import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { ContractsModule } from '../contracts/contracts.module';
import { FibermapModule } from '../fibermap/fibermap.module';
import { ProvisioningModule } from '../provisioning/provisioning.module';
import { StockModule } from '../stock/stock.module';

import { ServiceOrderReasonsController } from './service-order-reasons.controller';
import { ServiceOrderReasonsService } from './service-order-reasons.service';
import { ServiceOrdersController } from './service-orders.controller';
import { ServiceOrdersService } from './service-orders.service';

/**
 * Módulo Ordens de Serviço (O.S).
 *
 * Endpoints:
 *   /service-orders                       -> CRUD + start/complete/cancel
 *   /service-order-reasons                -> CRUD do cadastro de motivos (config)
 */
@Module({
  // Provisioning + Stock pro orquestrador one-touch (completeInstallation).
  // StorageModule é @Global — não precisa importar. Sem ciclo: ninguém importa
  // ServiceOrdersModule.
  imports: [AuditModule, ContractsModule, FibermapModule, ProvisioningModule, StockModule],
  controllers: [ServiceOrdersController, ServiceOrderReasonsController],
  providers: [ServiceOrdersService, ServiceOrderReasonsService],
  exports: [ServiceOrdersService],
})
export class ServiceOrdersModule {}
