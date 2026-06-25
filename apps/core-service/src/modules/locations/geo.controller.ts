import { Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import {
  CepParamSchema,
  IbgeSearchQuerySchema,
  type AuthenticatedPrincipal,
  type IbgeSearchQuery,
} from '@netx/shared';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { ZodQuery, ZodValidationPipe } from '../../common/zod.pipe';
import { GeoService } from './geo.service';

@ApiTags('locations')
@ApiBearerAuth()
@Controller('locations/geo')
export class GeoController {
  constructor(private readonly geo: GeoService) {}

  /** Autocomplete de município na referência nacional do IBGE. */
  @Get('ibge')
  @RequirePermissions('locations.read')
  searchIbge(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodQuery(IbgeSearchQuerySchema) query: IbgeSearchQuery,
  ) {
    return this.geo.searchIbge(user.tenantId, query);
  }

  /** Lookup de CEP via ViaCEP (logradouro/bairro/cidade/UF + código IBGE). */
  @Get('cep/:cep')
  @RequirePermissions('locations.read')
  lookupCep(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('cep', new ZodValidationPipe(CepParamSchema)) cep: string,
  ) {
    return this.geo.lookupCep(user.tenantId, cep);
  }
}
