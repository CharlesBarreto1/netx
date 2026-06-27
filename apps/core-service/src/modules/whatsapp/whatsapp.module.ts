import { Module } from '@nestjs/common';

import { AiModule } from '../ai/ai.module';
import { AuditModule } from '../audit/audit.module';

import { EvolutionClient } from './evolution.client';
import { WhatsappAiController } from './whatsapp-ai.controller';
import { WhatsappAiService } from './whatsapp-ai.service';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappConversationsService } from './whatsapp-conversations.service';
import { WhatsappEventsBus } from './whatsapp-events.bus';
import { WhatsappInstancesController } from './whatsapp-instances.controller';
import { WhatsappInstancesService } from './whatsapp-instances.service';
import { WhatsappMessagesService } from './whatsapp-messages.service';
import { WhatsappWebhookController } from './whatsapp-webhook.controller';

/**
 * Módulo Atendimento WhatsApp (Evolution API).
 *
 * Endpoints:
 *   /v1/whatsapp/conversations          — inbox + ações (atribuir, responder, fechar)
 *   /v1/whatsapp/instances              — admin: gerenciar sessões Evolution
 *   /v1/whatsapp/stream                 — SSE realtime
 *   /v1/whatsapp/media/:filename        — serve mídia baixada
 *   /v1/webhooks/evolution              — receiver dos webhooks Evolution
 *
 * MVP: sem URA, sem fluxos automáticos, sem templates. Multi-operador
 * com auditoria realtime via WhatsappConversationView.
 */
@Module({
  imports: [AuditModule, AiModule],
  controllers: [
    WhatsappController,
    WhatsappInstancesController,
    WhatsappWebhookController,
    WhatsappAiController,
  ],
  providers: [
    EvolutionClient,
    WhatsappEventsBus,
    WhatsappInstancesService,
    WhatsappConversationsService,
    WhatsappMessagesService,
    WhatsappAiService,
  ],
  exports: [WhatsappInstancesService],
})
export class WhatsappModule {}
