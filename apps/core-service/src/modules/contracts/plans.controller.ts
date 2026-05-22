/**
 * PlansController — /v1/plans (catálogo de planos de internet).
 *
 * Permissões:
 *   plans.manage  — CRUD de planos (admin/configuração).
 *   contracts.read — listar planos (operador precisa ver pra selecionar
 *                    no contrato). GET list aceita as duas.
 *
 * @provenance Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=
 */
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
  CreatePlanRequestSchema,
  ListPlansQuerySchema,
  UpdatePlanRequestSchema,
  type AuthenticatedPrincipal,
  type CreatePlanRequest,
  type ListPlansQuery,
  type UpdatePlanRequest,
} from '@netx/shared';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { ZodBody, ZodValidationPipe } from '../../common/zod.pipe';
import { PlansService } from './plans.service';

@ApiTags('plans')
@ApiBearerAuth()
@Controller('plans')
export class PlansController {
  constructor(private readonly svc: PlansService) {}

  /** Listar planos — operador precisa ver pra selecionar no contrato. */
  @Get()
  @RequirePermissions('contracts.read')
  list(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Query(new ZodValidationPipe(ListPlansQuerySchema)) q: ListPlansQuery,
  ) {
    return this.svc.list(user.tenantId, q);
  }

  @Get(':id')
  @RequirePermissions('contracts.read')
  findOne(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.svc.findById(user.tenantId, id);
  }

  @Post()
  @RequirePermissions('plans.manage')
  create(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodBody(CreatePlanRequestSchema) input: CreatePlanRequest,
  ) {
    return this.svc.create(user.tenantId, user.sub, input);
  }

  @Patch(':id')
  @RequirePermissions('plans.manage')
  update(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(UpdatePlanRequestSchema) input: UpdatePlanRequest,
  ) {
    return this.svc.update(user.tenantId, user.sub, id, input);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('plans.manage')
  async remove(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.svc.remove(user.tenantId, user.sub, id);
  }
}
