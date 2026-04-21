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
  CreateDealRequestSchema,
  GetDealsBoardQuerySchema,
  ListDealsQuerySchema,
  LoseDealRequestSchema,
  MoveDealStageRequestSchema,
  ReopenDealRequestSchema,
  ReorderDealsRequestSchema,
  UpdateDealRequestSchema,
  WinDealRequestSchema,
  type AuthenticatedPrincipal,
  type CreateDealRequest,
  type GetDealsBoardQuery,
  type ListDealsQuery,
  type LoseDealRequest,
  type MoveDealStageRequest,
  type ReopenDealRequest,
  type ReorderDealsRequest,
  type UpdateDealRequest,
  type WinDealRequest,
} from '@netx/shared';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { ZodBody } from '../../common/zod.pipe';
import { ZodQueryPipe } from './zod-query.pipe';
import { DealsService } from './deals.service';

@ApiTags('crm/deals')
@ApiBearerAuth()
@Controller('crm/deals')
export class DealsController {
  constructor(private readonly deals: DealsService) {}

  @Get()
  @RequirePermissions('deals.read')
  list(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Query(new ZodQueryPipe(ListDealsQuerySchema)) q: ListDealsQuery,
  ) {
    return this.deals.list(user.tenantId, q);
  }

  @Get('board')
  @RequirePermissions('deals.read')
  board(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Query(new ZodQueryPipe(GetDealsBoardQuerySchema)) q: GetDealsBoardQuery,
  ) {
    return this.deals.board(user.tenantId, q);
  }

  @Get(':id')
  @RequirePermissions('deals.read')
  getOne(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.deals.findById(user.tenantId, id);
  }

  @Get(':id/history')
  @RequirePermissions('deals.read')
  history(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.deals.history(user.tenantId, id);
  }

  @Post()
  @RequirePermissions('deals.write')
  create(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodBody(CreateDealRequestSchema) body: CreateDealRequest,
  ) {
    return this.deals.create(user.tenantId, user.sub, body);
  }

  @Patch(':id')
  @RequirePermissions('deals.write')
  update(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(UpdateDealRequestSchema) body: UpdateDealRequest,
  ) {
    return this.deals.update(user.tenantId, user.sub, id, body);
  }

  @Post(':id/move')
  @RequirePermissions('deals.write')
  move(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(MoveDealStageRequestSchema) body: MoveDealStageRequest,
  ) {
    return this.deals.move(user.tenantId, user.sub, id, body);
  }

  @Post('reorder')
  @HttpCode(204)
  @RequirePermissions('deals.write')
  async reorder(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodBody(ReorderDealsRequestSchema) body: ReorderDealsRequest,
  ): Promise<void> {
    await this.deals.reorder(user.tenantId, user.sub, body);
  }

  @Post(':id/win')
  @RequirePermissions('deals.write')
  win(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(WinDealRequestSchema) body: WinDealRequest,
  ) {
    return this.deals.win(user.tenantId, user.sub, id, body);
  }

  @Post(':id/lose')
  @RequirePermissions('deals.write')
  lose(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(LoseDealRequestSchema) body: LoseDealRequest,
  ) {
    return this.deals.lose(user.tenantId, user.sub, id, body);
  }

  @Post(':id/reopen')
  @RequirePermissions('deals.write')
  reopen(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(ReopenDealRequestSchema) body: ReopenDealRequest,
  ) {
    return this.deals.reopen(user.tenantId, user.sub, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('deals.delete')
  async remove(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.deals.remove(user.tenantId, user.sub, id);
  }
}
