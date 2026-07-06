/**
 * MappingModule — mapa comercial de clientes (Leaflet/OSM).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Sobrou UMA tela: Clientes (pinos coloridos por status + online via RADIUS).
 * O mapa de REDE (POPs/OLTs/caixas/cabos do OSP v1) foi aposentado — a planta
 * agora é documentada e visualizada no FiberMap (/fibermap).
 *
 * Reusa `normalizeMacForRadius` do RadacctService pra match em radacct.
 */
import { Module } from '@nestjs/common';

import { CustomerMapService } from './customer-map.service';
import { MappingController } from './mapping.controller';

@Module({
  controllers: [MappingController],
  providers: [CustomerMapService],
  exports: [CustomerMapService],
})
export class MappingModule {}
