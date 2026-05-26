/**
 * MappingModule — módulo de Mapeamento (Leaflet/OSM).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Subprodutos (5 telas no UI):
 *   - Clientes   ✅ (v1) — mapa com pinos coloridos por status RADIUS
 *   - Rede       ✅ (R1) — POPs + Equipamentos + OLTs
 *   - Backbone   ⏳ R3   — cabos de fibra (polylines)
 *   - Técnicos   ⏳ placeholder
 *   - Veículos   ⏳ placeholder
 *
 * Reusa `normalizeMacForRadius` do RadacctService pra match em radacct.
 */
import { Module } from '@nestjs/common';

import { CustomerMapService } from './customer-map.service';
import { MappingController } from './mapping.controller';
import { NetworkMapService } from './network-map.service';

@Module({
  controllers: [MappingController],
  providers: [CustomerMapService, NetworkMapService],
  exports: [CustomerMapService, NetworkMapService],
})
export class MappingModule {}
