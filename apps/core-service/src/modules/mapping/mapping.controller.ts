/**
 * MappingController — endpoints REST do módulo Mapeamento.
 *
 * Só /v1/mapping/customers (mapa comercial de clientes com status online via
 * RADIUS). O mapa de REDE legado (/mapping/network) foi aposentado junto com
 * o OSP v1 — a planta agora vive no FiberMap (/fibermap).
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
import { RequiresModule } from '../licensing/license.decorators';
import { CustomerMapService } from './customer-map.service';

@ApiTags('mapping')
@ApiBearerAuth()
@RequiresModule('netx-maps')
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
