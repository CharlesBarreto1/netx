import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';

import { ProductsService } from './products.service';
import { PurchasesService } from './purchases.service';
import { StockLocationsService } from './stock-locations.service';
import { StockMovementsService } from './stock-movements.service';
import { SuppliersService } from './suppliers.service';
import {
  ProductsController,
  PurchasesController,
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
  ],
  providers: [
    SuppliersService,
    ProductsService,
    StockLocationsService,
    PurchasesService,
    StockMovementsService,
  ],
  exports: [
    // Exportamos pra que Fase 2 (sales, comodato, OS) possa injetar
    // ProductsService.recalcAverageCost, StockLocationsService.assertCanWrite,
    // StockMovementsService pra criar movements de venda/comodato/consumo, etc.
    ProductsService,
    StockLocationsService,
    StockMovementsService,
  ],
})
export class StockModule {}
