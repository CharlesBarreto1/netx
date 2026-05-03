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
  CancelOneTimeChargeRequestSchema,
  CreateOneTimeChargeRequestSchema,
  ListOneTimeChargesQuerySchema,
  PayOneTimeChargeRequestSchema,
  UpdateOneTimeChargeRequestSchema,
  type AuthenticatedPrincipal,
  type CancelOneTimeChargeRequest,
  type CreateOneTimeChargeRequest,
  type ListOneTimeChargesQuery,
  type PayOneTimeChargeRequest,
  type UpdateOneTimeChargeRequest,
} from '@netx/shared';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { ZodBody } from '../../common/zod.pipe';
import { ZodQueryPipe } from '../crm/zod-query.pipe';
import { OneTimeChargesService } from './one-time-charges.service';

@ApiTags('finance')
@ApiBearerAuth()
@Controller('charges')
export class OneTimeChargesController {
  constructor(private readonly charges: OneTimeChargesService) {}

  @Get()
  @RequirePermissions('finance.charges.read')
  list(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Query(new ZodQueryPipe(ListOneTimeChargesQuerySchema)) q: ListOneTimeChargesQuery,
  ) {
    return this.charges.list(user.tenantId, q);
  }

  @Get(':id')
  @RequirePermissions('finance.charges.read')
  findOne(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.charges.findById(user.tenantId, id);
  }

  @Post()
  @RequirePermissions('finance.charges.write')
  create(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodBody(CreateOneTimeChargeRequestSchema) body: CreateOneTimeChargeRequest,
  ) {
    return this.charges.create(user.tenantId, user.sub, body);
  }

  @Patch(':id')
  @RequirePermissions('finance.charges.write')
  update(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(UpdateOneTimeChargeRequestSchema) body: UpdateOneTimeChargeRequest,
  ) {
    return this.charges.update(user.tenantId, user.sub, id, body);
  }

  @Post(':id/pay')
  @RequirePermissions('finance.charges.write')
  pay(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(PayOneTimeChargeRequestSchema) body: PayOneTimeChargeRequest,
  ) {
    const isManager = user.permissions.includes('cash_registers.manage');
    const canDiscount = user.permissions.includes('finance.discount.apply');
    return this.charges.pay(
      user.tenantId,
      user.sub,
      isManager,
      canDiscount,
      id,
      body,
    );
  }

  @Post(':id/cancel')
  @RequirePermissions('finance.charges.write')
  cancel(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(CancelOneTimeChargeRequestSchema) body: CancelOneTimeChargeRequest,
  ) {
    return this.charges.cancel(user.tenantId, user.sub, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('finance.charges.delete')
  async remove(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.charges.remove(user.tenantId, user.sub, id);
  }
}
