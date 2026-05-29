import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { FinanceModule } from '../finance/finance.module';

import { DriversService } from './drivers.service';
import { FleetExpensesService } from './fleet-expenses.service';
import { FleetLiveService } from './fleet-live.service';
import { MaintenanceService } from './maintenance.service';
import { TraccarService } from './traccar.service';
import { VehiclesService } from './vehicles.service';
import {
  DriversController,
  FleetExpensesController,
  FleetLiveController,
  MaintenanceController,
  VehiclesController,
} from './fleet.controller';

/**
 * Módulo Frota — veículos, motoristas, despesas (integradas ao caixa via
 * FinanceModule), manutenções preventivas e o "Ao vivo" (Traccar).
 */
@Module({
  imports: [AuditModule, FinanceModule],
  controllers: [
    VehiclesController,
    DriversController,
    FleetExpensesController,
    MaintenanceController,
    FleetLiveController,
  ],
  providers: [
    VehiclesService,
    DriversService,
    FleetExpensesService,
    MaintenanceService,
    FleetLiveService,
    TraccarService,
  ],
})
export class FleetModule {}
