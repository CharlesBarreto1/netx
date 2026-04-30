import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';

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
  imports: [AuditModule],
  controllers: [ServiceOrdersController, ServiceOrderReasonsController],
  providers: [ServiceOrdersService, ServiceOrderReasonsService],
  exports: [ServiceOrdersService],
})
export class ServiceOrdersModule {}
