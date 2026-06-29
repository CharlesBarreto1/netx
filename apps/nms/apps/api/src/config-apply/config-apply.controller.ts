import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ConfigApplyService } from './config-apply.service.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { CurrentUser, Roles } from '../auth/auth.decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import {
  ApplyConfigSchema,
  PlanConfigSchema,
  type ApplyConfigDto,
  type PlanConfigDto,
} from './config-apply.dto.js';

/** Escrita de config: operator+ apenas (§8). Toda ação é auditada e exige aprovação humana. */
@Controller('devices/:id/config')
export class ConfigApplyController {
  constructor(private readonly configApply: ConfigApplyService) {}

  /** Plan: calcula o diff sem efetivar (dry-run). */
  @Roles('admin', 'operator')
  @Post('plan')
  plan(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(PlanConfigSchema)) dto: PlanConfigDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.configApply.plan(id, dto.config, user.username);
  }

  /** Apply: efetiva a config com rollback automático armado (exige approve=true). */
  @Roles('admin', 'operator')
  @Post('apply')
  apply(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(ApplyConfigSchema)) dto: ApplyConfigDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.configApply.apply(id, dto.config, dto.confirmMinutes, user.username);
  }

  /** Confirm: trava o rollback automático (a mudança vira permanente). */
  @Roles('admin', 'operator')
  @Post('confirm')
  confirm(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.configApply.confirm(id, user.username);
  }
}
