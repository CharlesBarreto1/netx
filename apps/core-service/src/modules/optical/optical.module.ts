/**
 * OpticalModule — caixas ópticas (CTO/NAP/Splitter/Emenda) + portas.
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * R2 do roadmap OSP. Doc: docs/architecture/osp-network.md
 * Pré-requisito de R3 (cabos), R4 (fusões), R5 (power budget).
 */
import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { EnclosureTopologyService } from './enclosure-topology.service';
import { FiberCablesService } from './fiber-cables.service';
import { FiberEventsService } from './fiber-events.service';
import { FiberSplicesService } from './fiber-splices.service';
import { KmlService } from './kml.service';
import { NetworkFoldersService } from './network-folders.service';
import { OpticalController } from './optical.controller';
import { OpticalEnclosuresService } from './optical-enclosures.service';
import { PonPortsService } from './pon-ports.service';
import { PonTreeService } from './pon-tree.service';
import { PowerBudgetService } from './power-budget.service';
import { PowerBudgetTraversalService } from './power-budget-traversal.service';

@Module({
  imports: [AuditModule],
  controllers: [OpticalController],
  providers: [
    OpticalEnclosuresService,
    FiberCablesService,
    FiberSplicesService,
    FiberEventsService,
    EnclosureTopologyService,
    PowerBudgetService,
    KmlService,
    NetworkFoldersService,
    PonTreeService,
    PonPortsService,
    PowerBudgetTraversalService,
  ],
  exports: [
    OpticalEnclosuresService,
    FiberCablesService,
    FiberSplicesService,
    FiberEventsService,
    EnclosureTopologyService,
    PowerBudgetService,
    KmlService,
    NetworkFoldersService,
    PonTreeService,
    PonPortsService,
    PowerBudgetTraversalService,
  ],
})
export class OpticalModule {}
