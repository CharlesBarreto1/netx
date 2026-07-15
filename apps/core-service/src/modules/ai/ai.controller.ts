/**
 * AiController — status, config (admin) e teste do motor de IA do tenant.
 * O copiloto grounded (/copilot/ask) é o CopilotController. Webhooks/uso interno não passam aqui.
 */
import { Controller, Get, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import {
  UpsertAiConfigRequestSchema,
  type AuthenticatedPrincipal,
  type UpsertAiConfigRequest,
} from '@netx/shared';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { ZodBody } from '../../common/zod.pipe';

import { AiConfigService } from './ai-config.service';
import { AiService } from './ai.service';

/**
 * Completion genérico do motor de IA do tenant. Existe para OUTROS módulos do
 * ecossistema delegarem a IA ao NetX em vez de manter chave/provider próprios
 * (ex.: copiloto do NMS). O provider/chave/modelo saem da config do tenant
 * (Configurações › IA). Qualquer autenticado — a IA é conselheira read-only.
 */
const AiCompleteRequestSchema = z
  .object({
    messages: z
      .array(
        z.object({
          role: z.enum(['user', 'assistant']),
          content: z.string().min(1),
        }),
      )
      .min(1),
    system: z.string().max(8000).optional(),
    maxTokens: z.number().int().positive().max(4000).optional(),
    /** Rótulo de uso (telemetria AiUsageLog). Ex.: 'nms.copilot'. */
    feature: z.string().max(64).optional(),
  })
  .strict();
type AiCompleteRequest = z.infer<typeof AiCompleteRequestSchema>;

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

  /**
   * Completion genérico grounded — o chamador manda mensagens + system e recebe
   * o texto do motor do tenant. Usado pelo copiloto do NMS (canal 4) pra não ter
   * IA própria. Read-only: só gera texto, nunca executa ação.
   */
  @Post('complete')
  async complete(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodBody(AiCompleteRequestSchema) body: AiCompleteRequest,
  ) {
    const r = await this.ai.chat(
      user.tenantId,
      body.messages,
      { system: body.system, maxTokens: body.maxTokens },
      body.feature ?? 'ecosystem.complete',
    );
    return { text: r.text, provider: r.provider, model: r.model };
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
