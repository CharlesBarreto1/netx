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
import { FibermapAttenuationService } from './attenuation.service';
import { FibermapCatalogService } from './catalog.service';
import { FibermapController } from './fibermap.controller';
import { FibermapFoldersService } from './folders.service';

@Module({
  imports: [AuditModule],
  controllers: [FibermapController],
  providers: [
    FibermapFoldersService,
    FibermapCatalogService,
    FibermapAttenuationService,
  ],
  exports: [
    FibermapFoldersService,
    FibermapCatalogService,
    FibermapAttenuationService,
  ],
})
export class FibermapModule {}
