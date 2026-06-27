/**
 * AiController — status, config (admin) e teste do motor de IA do tenant.
 * O copiloto grounded (/ai/ask) entra na F3. Webhooks/uso interno não passam aqui.
 */
import { Controller, Get, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import {
  UpsertAiConfigRequestSchema,
  type AuthenticatedPrincipal,
  type UpsertAiConfigRequest,
} from '@netx/shared';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { ZodBody } from '../../common/zod.pipe';

import { AiConfigService } from './ai-config.service';
import { AiService } from './ai.service';

@ApiTags('ai')
@ApiBearerAuth()
@Controller('ai')
export class AiController {
  constructor(
    private readonly ai: AiService,
    private readonly config: AiConfigService,
  ) {}

  /** Status do motor (backends disponíveis). Qualquer autenticado pode ver. */
  @Get('status')
  status(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.ai.status(user.tenantId);
  }

  // ── Config (admin) ─────────────────────────────────────────────────────────
  @Get('config')
  @RequirePermissions('ai.config.read')
  getConfig(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.config.get(user.tenantId);
  }

  @Put('config')
  @RequirePermissions('ai.config.write')
  async upsertConfig(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodBody(UpsertAiConfigRequestSchema) body: UpsertAiConfigRequest,
  ) {
    const res = await this.config.upsert(user.tenantId, user.sub, body);
    this.ai.invalidate(user.tenantId);
    return res;
  }

  /** "Testar conexão" — dispara um prompt mínimo e devolve prova de vida. */
  @Post('config/test')
  @RequirePermissions('ai.config.write')
  test(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.ai.test(user.tenantId);
  }
}
