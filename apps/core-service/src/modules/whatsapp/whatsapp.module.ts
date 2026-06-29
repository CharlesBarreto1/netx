import { Module } from '@nestjs/common';

import { AiModule } from '../ai/ai.module';
import { AuditModule } from '../audit/audit.module';
import { BtgModule } from '../btg/btg.module';
import { ContractsModule } from '../contracts/contracts.module';
import { EfiModule } from '../efi/efi.module';
import { RadiusModule } from '../radius/radius.module';
import { ServiceOrdersModule } from '../service-orders/service-orders.module';

import { WhatsappBotController } from './bot/whatsapp-bot.controller';
import { WhatsappBotService } from './bot/whatsapp-bot.service';
import { WhatsappBillingRemindersService } from './whatsapp-billing-reminders.service';
import { ChannelProviderFactory } from './providers/channel-provider.factory';
import { MetaCloudProvider } from './providers/meta-cloud.provider';
import { WahaProvider } from './providers/waha.provider';
import { WhatsappCredentials } from './providers/whatsapp-credentials';
import { WhatsappAiController } from './whatsapp-ai.controller';
import { WhatsappAiService } from './whatsapp-ai.service';
import { WhatsappContactsController } from './whatsapp-contacts.controller';
import { WhatsappContactsService } from './whatsapp-contacts.service';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappConversationsService } from './whatsapp-conversations.service';
import { WhatsappEventsBus } from './whatsapp-events.bus';
import { WhatsappInstancesController } from './whatsapp-instances.controller';
import { WhatsappInstancesService } from './whatsapp-instances.service';
import { WhatsappMessagesService } from './whatsapp-messages.service';
import { WhatsappTemplatesController } from './whatsapp-templates.controller';
import { WhatsappTemplatesService } from './whatsapp-templates.service';
import { WhatsappWebhookController } from './whatsapp-webhook.controller';
import { WhatsappWebhookMetaController } from './whatsapp-webhook-meta.controller';

/**
 * Módulo Atendimento WhatsApp (Call) — dois canais sob abstração de provider:
 *   - WAHA       (QR, não-oficial, self-hosted)
 *   - META_CLOUD (oficial, WhatsApp Business Platform)
 *
 * Endpoints:
 *   /v1/whatsapp/conversations          — inbox + ações (atribuir, responder, fechar, template)
 *   /v1/whatsapp/instances              — admin: gerenciar instâncias (QR / Meta)
 *   /v1/whatsapp/instances/:id/templates — admin: sync/listar templates HSM
 *   /v1/whatsapp/stream                 — SSE realtime
 *   /v1/whatsapp/media/:filename        — serve mídia baixada
 *   /v1/webhooks/waha (+ /evolution)    — webhook WAHA (HMAC-512)
 *   /v1/webhooks/meta                   — webhook Meta (verify GET + HMAC-256)
 *
 * IA conselheira (read-only) via WhatsappAiService, agnóstica de canal.
 */
@Module({
  imports: [
    AuditModule,
    AiModule,
    EfiModule,
    BtgModule,
    ContractsModule,
    ServiceOrdersModule,
    RadiusModule,
  ],
  controllers: [
    WhatsappController,
    WhatsappContactsController,
    WhatsappInstancesController,
    WhatsappTemplatesController,
    WhatsappWebhookController,
    WhatsappWebhookMetaController,
    WhatsappAiController,
    WhatsappBotController,
  ],
  providers: [
    WahaProvider,
    MetaCloudProvider,
    ChannelProviderFactory,
    WhatsappCredentials,
    WhatsappEventsBus,
    WhatsappInstancesService,
    WhatsappContactsService,
    WhatsappConversationsService,
    WhatsappMessagesService,
    WhatsappTemplatesService,
    WhatsappAiService,
    WhatsappBotService,
    WhatsappBillingRemindersService,
  ],
  exports: [WhatsappInstancesService],
})
export class WhatsappModule {}
