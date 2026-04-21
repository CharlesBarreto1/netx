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
  CancelActivityRequestSchema,
  CompleteActivityRequestSchema,
  CreateActivityRequestSchema,
  ListActivitiesQuerySchema,
  UpdateActivityRequestSchema,
  type AuthenticatedPrincipal,
  type CancelActivityRequest,
  type CompleteActivityRequest,
  type CreateActivityRequest,
  type ListActivitiesQuery,
  type UpdateActivityRequest,
} from '@netx/shared';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { ZodBody } from '../../common/zod.pipe';
import { ZodQueryPipe } from './zod-query.pipe';
import { ActivitiesService } from './activities.service';

@ApiTags('crm/activities')
@ApiBearerAuth()
@Controller('crm/activities')
export class ActivitiesController {
  constructor(private readonly activities: ActivitiesService) {}

  @Get()
  @RequirePermissions('activities.read')
  list(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Query(new ZodQueryPipe(ListActivitiesQuerySchema)) q: ListActivitiesQuery,
  ) {
    return this.activities.list(user.tenantId, q);
  }

  @Get(':id')
  @RequirePermissions('activities.read')
  getOne(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.activities.findById(user.tenantId, id);
  }

  @Post()
  @RequirePermissions('activities.write')
  create(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodBody(CreateActivityRequestSchema) body: CreateActivityRequest,
  ) {
    return this.activities.create(user.tenantId, user.sub, body);
  }

  @Patch(':id')
  @RequirePermissions('activities.write')
  update(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(UpdateActivityRequestSchema) body: UpdateActivityRequest,
  ) {
    return this.activities.update(user.tenantId, user.sub, id, body);
  }

  @Post(':id/complete')
  @RequirePermissions('activities.write')
  complete(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(CompleteActivityRequestSchema) body: CompleteActivityRequest,
  ) {
    return this.activities.complete(user.tenantId, user.sub, id, body);
  }

  @Post(':id/cancel')
  @RequirePermissions('activities.write')
  cancel(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(CancelActivityRequestSchema) body: CancelActivityRequest,
  ) {
    return this.activities.cancel(user.tenantId, user.sub, id, body);
  }

  @Post(':id/reopen')
  @RequirePermissions('activities.write')
  reopen(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.activities.reopen(user.tenantId, user.sub, id);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('activities.delete')
  async remove(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.activities.remove(user.tenantId, user.sub, id);
  }
}
