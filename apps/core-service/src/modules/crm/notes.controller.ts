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
  CreateCustomerNoteRequestSchema,
  UpdateCustomerNoteRequestSchema,
  type AuthenticatedPrincipal,
  type CreateCustomerNoteRequest,
  type UpdateCustomerNoteRequest,
} from '@netx/shared';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { ZodBody } from '../../common/zod.pipe';
import { CustomerNotesService } from './notes.service';

@ApiTags('crm/customers')
@ApiBearerAuth()
@Controller('customers/:customerId/notes')
export class CustomerNotesController {
  constructor(private readonly notes: CustomerNotesService) {}

  @Get()
  @RequirePermissions('customers.read')
  list(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
  ) {
    return this.notes.list(user.tenantId, customerId);
  }

  @Post()
  @RequirePermissions('customers.notes.manage')
  create(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
    @ZodBody(CreateCustomerNoteRequestSchema) body: CreateCustomerNoteRequest,
  ) {
    return this.notes.create(user.tenantId, user.sub, customerId, body);
  }

  @Patch(':noteId')
  @RequirePermissions('customers.notes.manage')
  update(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
    @Param('noteId', new ParseUUIDPipe()) noteId: string,
    @ZodBody(UpdateCustomerNoteRequestSchema) body: UpdateCustomerNoteRequest,
  ) {
    return this.notes.update(user.tenantId, user.sub, customerId, noteId, body);
  }

  @Delete(':noteId')
  @HttpCode(204)
  @RequirePermissions('customers.notes.manage')
  async remove(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
    @Param('noteId', new ParseUUIDPipe()) noteId: string,
  ): Promise<void> {
    await this.notes.remove(user.tenantId, user.sub, customerId, noteId);
  }
}
