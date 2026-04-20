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
  CreateCustomerContactRequestSchema,
  UpdateCustomerContactRequestSchema,
  type AuthenticatedPrincipal,
  type CreateCustomerContactRequest,
  type UpdateCustomerContactRequest,
} from '@netx/shared';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { ZodBody } from '../../common/zod.pipe';
import { CustomerContactsService } from './contacts.service';

@ApiTags('crm/customers')
@ApiBearerAuth()
@Controller('customers/:customerId/contacts')
export class CustomerContactsController {
  constructor(private readonly contacts: CustomerContactsService) {}

  @Get()
  @RequirePermissions('customers.read')
  list(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
  ) {
    return this.contacts.list(user.tenantId, customerId);
  }

  @Post()
  @RequirePermissions('customers.update')
  create(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
    @ZodBody(CreateCustomerContactRequestSchema) body: CreateCustomerContactRequest,
  ) {
    return this.contacts.create(user.tenantId, user.sub, customerId, body);
  }

  @Patch(':contactId')
  @RequirePermissions('customers.update')
  update(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
    @Param('contactId', new ParseUUIDPipe()) contactId: string,
    @ZodBody(UpdateCustomerContactRequestSchema) body: UpdateCustomerContactRequest,
  ) {
    return this.contacts.update(user.tenantId, user.sub, customerId, contactId, body);
  }

  @Delete(':contactId')
  @HttpCode(204)
  @RequirePermissions('customers.update')
  async remove(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
    @Param('contactId', new ParseUUIDPipe()) contactId: string,
  ): Promise<void> {
    await this.contacts.remove(user.tenantId, user.sub, customerId, contactId);
  }
}
