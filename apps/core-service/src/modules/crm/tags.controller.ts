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
  CreateCustomerTagRequestSchema,
  UpdateCustomerTagRequestSchema,
  type AuthenticatedPrincipal,
  type CreateCustomerTagRequest,
  type UpdateCustomerTagRequest,
} from '@netx/shared';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { ZodBody } from '../../common/zod.pipe';
import { CustomerTagsService } from './tags.service';

@ApiTags('crm/tags')
@ApiBearerAuth()
@Controller('crm/tags')
export class CustomerTagsController {
  constructor(private readonly tags: CustomerTagsService) {}

  @Get()
  @RequirePermissions('customers.read')
  list(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.tags.list(user.tenantId);
  }

  @Post()
  @RequirePermissions('customers.tags.manage')
  create(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodBody(CreateCustomerTagRequestSchema) body: CreateCustomerTagRequest,
  ) {
    return this.tags.create(user.tenantId, user.sub, body);
  }

  @Patch(':id')
  @RequirePermissions('customers.tags.manage')
  update(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(UpdateCustomerTagRequestSchema) body: UpdateCustomerTagRequest,
  ) {
    return this.tags.update(user.tenantId, user.sub, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('customers.tags.manage')
  async remove(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.tags.remove(user.tenantId, user.sub, id);
  }
}
