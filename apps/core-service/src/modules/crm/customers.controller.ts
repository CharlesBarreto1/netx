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
  AssignTagsRequestSchema,
  CreateCustomerRequestSchema,
  ListCustomersQuerySchema,
  UpdateCustomerRequestSchema,
  type AssignTagsRequest,
  type AuthenticatedPrincipal,
  type CreateCustomerRequest,
  type ListCustomersQuery,
  type UpdateCustomerRequest,
} from '@netx/shared';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { ZodBody } from '../../common/zod.pipe';
import { ZodQueryPipe } from './zod-query.pipe';
import { CustomersService } from './customers.service';

@ApiTags('crm/customers')
@ApiBearerAuth()
@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @RequirePermissions('customers.read')
  list(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Query(new ZodQueryPipe(ListCustomersQuerySchema)) q: ListCustomersQuery,
  ) {
    return this.customers.list(user.tenantId, q);
  }

  @Get(':id')
  @RequirePermissions('customers.read')
  findOne(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.customers.findById(user.tenantId, id);
  }

  @Post()
  @RequirePermissions('customers.create')
  create(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodBody(CreateCustomerRequestSchema) body: CreateCustomerRequest,
  ) {
    return this.customers.create(user.tenantId, user.sub, body);
  }

  @Patch(':id')
  @RequirePermissions('customers.update')
  update(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(UpdateCustomerRequestSchema) body: UpdateCustomerRequest,
  ) {
    return this.customers.update(user.tenantId, user.sub, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('customers.delete')
  async remove(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.customers.softDelete(user.tenantId, user.sub, id);
  }

  // ---------------------------------------------------------------------------
  // Tag management (shortcuts)
  // ---------------------------------------------------------------------------
  @Post(':id/tags')
  @HttpCode(204)
  @RequirePermissions('customers.tags.manage')
  async assignTags(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(AssignTagsRequestSchema) body: AssignTagsRequest,
  ): Promise<void> {
    await this.customers.assignTags(user.tenantId, user.sub, id, body.tagIds);
  }

  @Delete(':id/tags/:tagId')
  @HttpCode(204)
  @RequirePermissions('customers.tags.manage')
  async removeTag(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('tagId', new ParseUUIDPipe()) tagId: string,
  ): Promise<void> {
    await this.customers.removeTag(user.tenantId, user.sub, id, tagId);
  }
}
