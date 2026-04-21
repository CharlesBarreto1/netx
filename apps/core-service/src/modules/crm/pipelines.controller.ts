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
  CreatePipelineRequestSchema,
  CreateStageRequestSchema,
  ListPipelinesQuerySchema,
  ReorderStagesRequestSchema,
  UpdatePipelineRequestSchema,
  UpdateStageRequestSchema,
  type AuthenticatedPrincipal,
  type CreatePipelineRequest,
  type CreateStageRequest,
  type ListPipelinesQuery,
  type ReorderStagesRequest,
  type UpdatePipelineRequest,
  type UpdateStageRequest,
} from '@netx/shared';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { ZodBody } from '../../common/zod.pipe';
import { ZodQueryPipe } from './zod-query.pipe';
import { PipelinesService } from './pipelines.service';

@ApiTags('crm/pipelines')
@ApiBearerAuth()
@Controller('crm/pipelines')
export class PipelinesController {
  constructor(private readonly pipelines: PipelinesService) {}

  @Get()
  @RequirePermissions('deals.read')
  list(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Query(new ZodQueryPipe(ListPipelinesQuerySchema)) q: ListPipelinesQuery,
  ) {
    return this.pipelines.list(user.tenantId, q.includeArchived);
  }

  @Get('default')
  @RequirePermissions('deals.read')
  getDefault(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.pipelines.findDefault(user.tenantId);
  }

  @Get(':id')
  @RequirePermissions('deals.read')
  getOne(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.pipelines.findById(user.tenantId, id);
  }

  @Post()
  @RequirePermissions('pipelines.manage')
  create(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodBody(CreatePipelineRequestSchema) body: CreatePipelineRequest,
  ) {
    return this.pipelines.create(user.tenantId, user.sub, body);
  }

  @Patch(':id')
  @RequirePermissions('pipelines.manage')
  update(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(UpdatePipelineRequestSchema) body: UpdatePipelineRequest,
  ) {
    return this.pipelines.update(user.tenantId, user.sub, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('pipelines.manage')
  async remove(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.pipelines.remove(user.tenantId, user.sub, id);
  }

  // ---------------------------------------------------------------------------
  // Stages
  // ---------------------------------------------------------------------------
  @Post(':id/stages')
  @RequirePermissions('pipelines.manage')
  createStage(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) pipelineId: string,
    @ZodBody(CreateStageRequestSchema) body: CreateStageRequest,
  ) {
    return this.pipelines.createStage(user.tenantId, user.sub, pipelineId, body);
  }

  @Patch(':id/stages/:stageId')
  @RequirePermissions('pipelines.manage')
  updateStage(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) pipelineId: string,
    @Param('stageId', new ParseUUIDPipe()) stageId: string,
    @ZodBody(UpdateStageRequestSchema) body: UpdateStageRequest,
  ) {
    return this.pipelines.updateStage(user.tenantId, user.sub, pipelineId, stageId, body);
  }

  @Delete(':id/stages/:stageId')
  @HttpCode(204)
  @RequirePermissions('pipelines.manage')
  async removeStage(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) pipelineId: string,
    @Param('stageId', new ParseUUIDPipe()) stageId: string,
  ): Promise<void> {
    await this.pipelines.removeStage(user.tenantId, user.sub, pipelineId, stageId);
  }

  @Post(':id/stages/reorder')
  @RequirePermissions('pipelines.manage')
  reorderStages(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) pipelineId: string,
    @ZodBody(ReorderStagesRequestSchema) body: ReorderStagesRequest,
  ) {
    return this.pipelines.reorderStages(user.tenantId, user.sub, pipelineId, body.stageIds);
  }
}
