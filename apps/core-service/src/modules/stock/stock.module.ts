import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';

import { ComodatoService } from './comodato.service';
import { OsConsumptionService } from './os-consumption.service';
import { ProductsService } from './products.service';
import { PurchasesService } from './purchases.service';
import { StockLocationsService } from './stock-locations.service';
import { StockMovementsService } from './stock-movements.service';
import { SerialItemsService } from './serial-items.service';
import { SuppliersService } from './suppliers.service';
import {
  ComodatoController,
  OsConsumptionController,
  ProductsController,
  PurchasesController,
  SerialItemsController,
  StockLocationsController,
  StockMovementsController,
  SuppliersController,
} from './stock.controller';

@Module({
  imports: [AuditModule],
  controllers: [
    SuppliersController,
    ProductsController,
    StockLocationsController,
    PurchasesController,
    StockMovementsController,
    SerialItemsController,
    ComodatoController,
    OsConsumptionController,
  ],
  providers: [
    SuppliersService,
    ProductsService,
    StockLocationsService,
    PurchasesService,
    StockMovementsService,
    SerialItemsService,
    ComodatoService,
    OsConsumptionService,
  ],
  exports: [
    // Exportamos pra que outros módulos (ServiceOrders, futuros) possam usar
    // os helpers de stock — recalc custo médio, ACL, movement, comodato.
    ProductsService,
    StockLocationsService,
    StockMovementsService,
    ComodatoService,
    OsConsumptionService,
  ],
})
export class StockModule {}
