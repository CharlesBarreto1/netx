/**
 * MappingController — endpoints REST do módulo Mapeamento.
 *
 * Hoje só /v1/mapping/customers. Conforme abre os subprodutos (Rede,
 * Backbone, Técnicos, Veículos) adicionar rotas aqui ou splittar em
 * controllers separados.
 */
import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  ListCustomerMapQuerySchema,
  type AuthenticatedPrincipal,
  type ListCustomerMapQuery,
} from '@netx/shared';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { ZodQueryPipe } from '../crm/zod-query.pipe';
import { CustomerMapService } from './customer-map.service';

@ApiTags('mapping')
@ApiBearerAuth()
@Controller('mapping')
export class MappingController {
  constructor(private readonly customerMap: CustomerMapService) {}

  @Get('customers')
  @RequirePermissions('mapping.read')
  listCustomers(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Query(new ZodQueryPipe(ListCustomerMapQuerySchema)) q: ListCustomerMapQuery,
  ) {
    return this.customerMap.listCustomerPoints(user.tenantId, q);
  }
}
