/**
 * Endpoints de IA conselheira do atendimento (F4). Read-only: sugerem/resumem,
 * nunca enviam. Reusam as permissões de chat (sem nova permissão / re-login).
 *
 *   POST /v1/whatsapp/conversations/:id/ai/suggest   — resposta sugerida (chat.send)
 *   GET  /v1/whatsapp/conversations/:id/ai/insights  — resumo/intenção/sentimento (chat.read)
 */
import { Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import type { AuthenticatedPrincipal } from '@netx/shared';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { RequiresModule } from '../licensing/license.decorators';

import { WhatsappAiService } from './whatsapp-ai.service';

@ApiTags('whatsapp')
@ApiBearerAuth()
@RequiresModule('netx-call')
@Controller('whatsapp/conversations')
export class WhatsappAiController {
  constructor(private readonly ai: WhatsappAiService) {}

  /** Sugere uma resposta para o operador revisar e enviar. */
  @Post(':id/ai/suggest')
  @RequirePermissions('chat.send')
  suggest(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedPrincipal,
  ) {
    return this.ai.suggestReply(user.tenantId, id);
  }

  /** Resumo + intenção + sentimento + urgência da conversa. */
  @Get(':id/ai/insights')
  @RequirePermissions('chat.read')
  insights(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedPrincipal,
  ) {
    return this.ai.insights(user.tenantId, id);
  }
}
