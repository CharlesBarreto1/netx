import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import {
  CreateServiceOrderReasonRequestSchema,
  ListServiceOrderReasonsQuerySchema,
  UpdateServiceOrderReasonRequestSchema,
  type AuthenticatedPrincipal,
  type CreateServiceOrderReasonRequest,
  type ListServiceOrderReasonsQuery,
  type UpdateServiceOrderReasonRequest,
} from '@netx/shared';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { ZodBody } from '../../common/zod.pipe';
import { ZodQueryPipe } from '../crm/zod-query.pipe';
import { ServiceOrderReasonsService } from './service-order-reasons.service';

@ApiTags('service-orders')
@ApiBearerAuth()
@Controller('service-order-reasons')
export class ServiceOrderReasonsController {
  constructor(private readonly reasons: ServiceOrderReasonsService) {}

  /** Pra select no form de O.S (qualquer user com service_orders.read). */
  @Get()
  @RequirePermissions('service_orders.read')
  list(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Query(new ZodQueryPipe(ListServiceOrderReasonsQuerySchema))
    q: ListServiceOrderReasonsQuery,
  ) {
    return this.reasons.list(user.tenantId, q);
  }

  @Get(':id')
  @RequirePermissions('service_orders.read')
  findOne(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.reasons.findById(user.tenantId, id);
  }

  @Post()
  @RequirePermissions('service_order_reasons.manage')
  create(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodBody(CreateServiceOrderReasonRequestSchema)
    body: CreateServiceOrderReasonRequest,
  ) {
    return this.reasons.create(user.tenantId, user.sub, body);
  }

  @Patch(':id')
  @RequirePermissions('service_order_reasons.manage')
  update(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(UpdateServiceOrderReasonRequestSchema)
    body: UpdateServiceOrderReasonRequest,
  ) {
    return this.reasons.update(user.tenantId, user.sub, id, body);
  }

  /** Soft-delete: marca isActive=false. */
  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('service_order_reasons.manage')
  async remove(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.reasons.deactivate(user.tenantId, user.sub, id);
  }
}
