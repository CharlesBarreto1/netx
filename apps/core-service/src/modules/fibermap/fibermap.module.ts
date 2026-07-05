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
import { FibermapConnectionsService } from './connections.service';
import { FibermapCatalogService } from './catalog.service';
import { FibermapController } from './fibermap.controller';
import { FibermapElementPhotosService } from './element-photos.service';
import { FibermapElementsService } from './elements.service';
import { FibermapFoldersService } from './folders.service';

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
  ],
  exports: [
    FibermapFoldersService,
    FibermapCatalogService,
    FibermapAttenuationService,
    FibermapElementsService,
    FibermapCablesService,
  ],
})
export class FibermapModule {}
