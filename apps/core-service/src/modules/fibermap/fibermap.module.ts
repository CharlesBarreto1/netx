/**
 * FibermapModule — documentação de planta externa OSP v2 (FIBERMAP-SPEC.md).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * FM-0: fundação (pastas, catálogo, atenuação). As fases seguintes adicionam
 * services de elementos/cabos/conexões/trace/OTDR/power budget aqui.
 * Fronteira HTTP declarada em licensing/module-manifests.ts ('/fibermap');
 * gating por entitlement `netx-fibermap` no controller.
 */
import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { FibermapAccessPointService } from './access-point.service';
import { FibermapAttenuationService } from './attenuation.service';
import { FibermapCablesService } from './cables.service';
import { FibermapConnectivityGraphService } from './connectivity-graph.service';
import { FibermapConnectionsService } from './connections.service';
import { FibermapCatalogService } from './catalog.service';
import { FibermapController } from './fibermap.controller';
import { FibermapElementPhotosService } from './element-photos.service';
import { FibermapElementsService } from './elements.service';
import { FibermapFoldersService } from './folders.service';
import { FibermapOtdrService } from './otdr.service';
import { FibermapPowerBudgetService } from './power-budget.service';
import { FibermapReportsService } from './reports.service';

@Module({
  imports: [AuditModule], // StorageModule é @Global — não precisa importar
  controllers: [FibermapController],
  providers: [
    FibermapFoldersService,
    FibermapCatalogService,
    FibermapAttenuationService,
    FibermapElementsService,
    FibermapElementPhotosService,
    FibermapCablesService,
    FibermapAccessPointService,
    FibermapConnectionsService,
    FibermapConnectivityGraphService,
    FibermapOtdrService,
    FibermapPowerBudgetService,
    FibermapReportsService,
  ],
  exports: [
    FibermapFoldersService,
    FibermapCatalogService,
    FibermapAttenuationService,
    FibermapElementsService,
    FibermapCablesService,
    // OTDR (FM-5) e power budget (FM-6) reusam o grafo/trace.
    FibermapConnectivityGraphService,
  ],
})
export class FibermapModule {}
