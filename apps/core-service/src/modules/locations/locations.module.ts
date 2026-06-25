import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';

import { CitiesController } from './cities.controller';
import { CitiesService } from './cities.service';
import { NeighborhoodsController } from './neighborhoods.controller';
import { NeighborhoodsService } from './neighborhoods.service';
import { StreetsController } from './streets.controller';
import { StreetsService } from './streets.service';
import { GeoController } from './geo.controller';
import { GeoService } from './geo.service';
import { AddressBackfillController } from './address-backfill.controller';
import { AddressBackfillService } from './address-backfill.service';

/**
 * Módulo — Cadastro-mestre de endereços (BR).
 *
 * Substitui o texto livre do endereço de instalação por seleção hierárquica:
 *   /locations/cities          -> cidades operadas (com código IBGE)
 *   /locations/neighborhoods   -> bairros por cidade
 *   /locations/streets         -> logradouros (com CEP) por cidade
 *   /locations/geo/ibge        -> autocomplete na referência nacional IBGE
 *   /locations/geo/cep/:cep    -> lookup ViaCEP (logradouro/bairro/cidade/IBGE)
 *
 * Todo o módulo é gated por país: só responde p/ tenants BR (assertBrTenant);
 * PY segue com endereço em texto livre.
 */
@Module({
  imports: [AuditModule],
  controllers: [
    CitiesController,
    NeighborhoodsController,
    StreetsController,
    GeoController,
    AddressBackfillController,
  ],
  providers: [
    CitiesService,
    NeighborhoodsService,
    StreetsService,
    GeoService,
    AddressBackfillService,
  ],
  exports: [CitiesService, NeighborhoodsService, StreetsService],
})
export class LocationsModule {}
