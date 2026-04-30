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
  CancelServiceOrderRequestSchema,
  CompleteServiceOrderRequestSchema,
  CreateServiceOrderRequestSchema,
  ListServiceOrdersQuerySchema,
  StartServiceOrderRequestSchema,
  UpdateServiceOrderRequestSchema,
  type AuthenticatedPrincipal,
  type CancelServiceOrderRequest,
  type CompleteServiceOrderRequest,
  type CreateServiceOrderRequest,
  type ListServiceOrdersQuery,
  type StartServiceOrderRequest,
  type UpdateServiceOrderRequest,
} from '@netx/shared';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { ZodBody } from '../../common/zod.pipe';
import { ZodQueryPipe } from '../crm/zod-query.pipe';
import { ServiceOrdersService } from './service-orders.service';

@ApiTags('service-orders')
@ApiBearerAuth()
@Controller('service-orders')
export class ServiceOrdersController {
  constructor(private readonly orders: ServiceOrdersService) {}

  @Get()
  @RequirePermissions('service_orders.read')
  list(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Query(new ZodQueryPipe(ListServiceOrdersQuerySchema)) q: ListServiceOrdersQuery,
  ) {
    return this.orders.list(user.tenantId, q);
  }

  @Get(':id')
  @RequirePermissions('service_orders.read')
  findOne(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.orders.findById(user.tenantId, id);
  }

  @Post()
  @RequirePermissions('service_orders.write')
  create(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodBody(CreateServiceOrderRequestSchema) body: CreateServiceOrderRequest,
  ) {
    return this.orders.create(user.tenantId, user.sub, body);
  }

  @Patch(':id')
  @RequirePermissions('service_orders.write')
  update(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(UpdateServiceOrderRequestSchema) body: UpdateServiceOrderRequest,
  ) {
    return this.orders.update(user.tenantId, user.sub, id, body);
  }

  @Post(':id/start')
  @RequirePermissions('service_orders.write')
  start(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(StartServiceOrderRequestSchema) body: StartServiceOrderRequest,
  ) {
    return this.orders.start(user.tenantId, user.sub, id, body);
  }

  @Post(':id/complete')
  @RequirePermissions('service_orders.write')
  complete(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(CompleteServiceOrderRequestSchema) body: CompleteServiceOrderRequest,
  ) {
    return this.orders.complete(user.tenantId, user.sub, id, body);
  }

  @Post(':id/cancel')
  @RequirePermissions('service_orders.write')
  cancel(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(CancelServiceOrderRequestSchema) body: CancelServiceOrderRequest,
  ) {
    return this.orders.cancel(user.tenantId, user.sub, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('service_orders.delete')
  async remove(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.orders.remove(user.tenantId, user.sub, id);
  }
}
