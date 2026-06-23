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
  ListNetworkMapQuerySchema,
  type AuthenticatedPrincipal,
  type ListCustomerMapQuery,
  type ListNetworkMapQuery,
} from '@netx/shared';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { ZodQueryPipe } from '../crm/zod-query.pipe';
import { RequiresModule } from '../licensing/license.decorators';
import { CustomerMapService } from './customer-map.service';
import { NetworkMapService } from './network-map.service';

@ApiTags('mapping')
@ApiBearerAuth()
@RequiresModule('netx-maps')
@Controller('mapping')
export class MappingController {
  constructor(
    private readonly customerMap: CustomerMapService,
    private readonly networkMap: NetworkMapService,
  ) {}

  @Get('customers')
  @RequirePermissions('mapping.read')
  listCustomers(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Query(new ZodQueryPipe(ListCustomerMapQuerySchema)) q: ListCustomerMapQuery,
  ) {
    return this.customerMap.listCustomerPoints(user.tenantId, q);
  }

  /**
   * Pontos físicos da planta de rede: POPs + Equipamentos + OLTs.
   * Permissão `network.read` (não `mapping.read`) porque dados são
   * de inventário de rede — operador comercial não precisa ver.
   */
  @Get('network')
  @RequirePermissions('network.read')
  listNetwork(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Query(new ZodQueryPipe(ListNetworkMapQuerySchema)) q: ListNetworkMapQuery,
  ) {
    return this.networkMap.listPoints(user.tenantId, q);
  }
}
