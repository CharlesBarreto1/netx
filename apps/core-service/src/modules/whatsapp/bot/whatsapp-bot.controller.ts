import { Controller, Get, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import type { AuthenticatedPrincipal } from '@netx/shared';
import { CurrentUser, RequirePermissions } from '../../../common/decorators';
import { ZodBody } from '../../../common/zod.pipe';
import { RequiresModule } from '../../licensing/license.decorators';

import { WhatsappBotService, type BotConfigDto } from './whatsapp-bot.service';

const OptionSchema = z.object({
  key: z.string().min(1).max(8),
  label: z.string().min(1).max(80),
  action: z.enum(['tool', 'reply', 'handoff', 'ai']),
  tool: z.string().max(40).optional(),
  reply: z.string().max(2000).optional(),
});

const BotConfigSchema = z.object({
  enabled: z.boolean(),
  aiEnabled: z.boolean(),
  greeting: z.string().max(2000),
  fallbackText: z.string().max(2000),
  handoffText: z.string().max(2000),
  unknownText: z.string().max(2000),
  options: z.array(OptionSchema).max(20),
});
type BotConfigBody = z.infer<typeof BotConfigSchema>;

/**
 * Configuração do chatbot de atendimento (um por tenant).
 * Permissão: chat.admin.
 *   GET /v1/whatsapp/bot — lê a config (com defaults)
 *   PUT /v1/whatsapp/bot — salva a config (toggles, textos, menu)
 */
@ApiTags('whatsapp-bot')
@ApiBearerAuth()
@RequiresModule('netx-call')
@Controller('whatsapp/bot')
export class WhatsappBotController {
  constructor(private readonly bot: WhatsappBotService) {}

  @Get()
  @RequirePermissions('chat.admin')
  get(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.bot.getConfig(user.tenantId);
  }

  @Put()
  @RequirePermissions('chat.admin')
  update(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodBody(BotConfigSchema) body: BotConfigBody,
  ) {
    return this.bot.updateConfig(user.tenantId, user.sub, body as BotConfigDto);
  }
}
