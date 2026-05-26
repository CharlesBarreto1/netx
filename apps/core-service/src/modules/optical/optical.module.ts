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
import { FiberCablesService } from './fiber-cables.service';
import { OpticalController } from './optical.controller';
import { OpticalEnclosuresService } from './optical-enclosures.service';

@Module({
  imports: [AuditModule],
  controllers: [OpticalController],
  providers: [OpticalEnclosuresService, FiberCablesService],
  exports: [OpticalEnclosuresService, FiberCablesService],
})
export class OpticalModule {}
