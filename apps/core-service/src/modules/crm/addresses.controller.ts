import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import {
  CreateCustomerAddressRequestSchema,
  UpdateCustomerAddressRequestSchema,
  type AuthenticatedPrincipal,
  type CreateCustomerAddressRequest,
  type UpdateCustomerAddressRequest,
} from '@netx/shared';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { ZodBody } from '../../common/zod.pipe';
import { CustomerAddressesService } from './addresses.service';

@ApiTags('crm/customers')
@ApiBearerAuth()
@Controller('customers/:customerId/addresses')
export class CustomerAddressesController {
  constructor(private readonly addresses: CustomerAddressesService) {}

  @Get()
  @RequirePermissions('customers.read')
  list(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
  ) {
    return this.addresses.list(user.tenantId, customerId);
  }

  @Post()
  @RequirePermissions('customers.update')
  create(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
    @ZodBody(CreateCustomerAddressRequestSchema) body: CreateCustomerAddressRequest,
  ) {
    return this.addresses.create(user.tenantId, user.sub, customerId, body);
  }

  @Patch(':addressId')
  @RequirePermissions('customers.update')
  update(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
    @Param('addressId', new ParseUUIDPipe()) addressId: string,
    @ZodBody(UpdateCustomerAddressRequestSchema) body: UpdateCustomerAddressRequest,
  ) {
    return this.addresses.update(user.tenantId, user.sub, customerId, addressId, body);
  }

  @Delete(':addressId')
  @HttpCode(204)
  @RequirePermissions('customers.update')
  async remove(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
    @Param('addressId', new ParseUUIDPipe()) addressId: string,
  ): Promise<void> {
    await this.addresses.remove(user.tenantId, user.sub, customerId, addressId);
  }
}
