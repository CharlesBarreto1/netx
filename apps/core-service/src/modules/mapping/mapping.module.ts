/**
 * MappingModule — módulo de Mapeamento (Leaflet/OSM).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Subprodutos (5 telas no UI):
 *   - Clientes   ✅ (v1) — mapa com pinos coloridos por status RADIUS
 *   - Rede       ⏳ placeholder
 *   - Backbone   ⏳ placeholder
 *   - Técnicos   ⏳ placeholder
 *   - Veículos   ⏳ placeholder
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
