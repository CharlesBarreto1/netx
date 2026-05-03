import {
  Body,
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
  AddCashRegisterMemberRequestSchema,
  CreateCashRegisterRequestSchema,
  ListCashRegistersQuerySchema,
  UpdateCashRegisterRequestSchema,
  type AddCashRegisterMemberRequest,
  type AuthenticatedPrincipal,
  type CreateCashRegisterRequest,
  type ListCashRegistersQuery,
  type UpdateCashRegisterRequest,
} from '@netx/shared';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { ZodBody } from '../../common/zod.pipe';
import { ZodQueryPipe } from '../crm/zod-query.pipe';
import { CashRegistersService } from './cash-registers.service';

@ApiTags('finance')
@ApiBearerAuth()
@Controller('cash-registers')
export class CashRegistersController {
  constructor(private readonly registers: CashRegistersService) {}

  @Get()
  @RequirePermissions('finance.charges.read') // mínimo pra ver lista; admins têm sempre
  list(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Query(new ZodQueryPipe(ListCashRegistersQuerySchema)) q: ListCashRegistersQuery,
  ) {
    const isManager = user.permissions.includes('cash_registers.manage');
    return this.registers.list(user.tenantId, user.sub, isManager, q);
  }

  @Get(':id')
  @RequirePermissions('finance.charges.read')
  findOne(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const isManager = user.permissions.includes('cash_registers.manage');
    return this.registers.findById(user.tenantId, user.sub, isManager, id);
  }

  @Post()
  @RequirePermissions('cash_registers.manage')
  create(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodBody(CreateCashRegisterRequestSchema) body: CreateCashRegisterRequest,
  ) {
    return this.registers.create(user.tenantId, user.sub, body);
  }

  @Patch(':id')
  @RequirePermissions('cash_registers.manage')
  update(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(UpdateCashRegisterRequestSchema) body: UpdateCashRegisterRequest,
  ) {
    return this.registers.update(user.tenantId, user.sub, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('cash_registers.manage')
  async remove(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.registers.deactivate(user.tenantId, user.sub, id);
  }

  @Post(':id/members')
  @RequirePermissions('cash_registers.manage')
  addMember(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(AddCashRegisterMemberRequestSchema) body: AddCashRegisterMemberRequest,
  ) {
    return this.registers.addMember(user.tenantId, user.sub, id, body);
  }

  @Delete(':id/members/:userId')
  @HttpCode(204)
  @RequirePermissions('cash_registers.manage')
  async removeMember(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('userId', new ParseUUIDPipe()) userId: string,
  ): Promise<void> {
    await this.registers.removeMember(user.tenantId, user.sub, id, userId);
  }
}
