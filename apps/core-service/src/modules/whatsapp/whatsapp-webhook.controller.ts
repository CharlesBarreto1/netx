import {
  Controller,
  ForbiddenException,
  HttpCode,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';

import { Public } from '../../common/decorators';

import { WhatsappBotService } from './bot/whatsapp-bot.service';
import { WahaProvider } from './providers/waha.provider';
import { WhatsappEventsBus } from './whatsapp-events.bus';
import { WhatsappInstancesService } from './whatsapp-instances.service';
import { WhatsappMessagesService } from './whatsapp-messages.service';

/**
 * Webhook receiver do WAHA.
 *
 * Rotas:
 *   POST /v1/webhooks/waha       — receiver oficial
 *   POST /v1/webhooks/evolution  — alias legado (transição Evolution→WAHA)
 *
 * Autenticação: HMAC-SHA512 em `X-Webhook-Hmac` sobre o corpo CRU, validado
 * contra o `webhookSecret` por instância. Por isso lemos `req.rawBody`
 * (habilitado via rawBody:true no main.ts).
 *
 * Resposta SEMPRE 200 — WAHA reentrega em 4xx/5xx (geraria duplicatas).
 */
@ApiTags('webhooks')
@Controller('webhooks')
export class WhatsappWebhookController {
  private readonly logger = new Logger(WhatsappWebhookController.name);

  constructor(
    private readonly instances: WhatsappInstancesService,
    private readonly messages: WhatsappMessagesService,
    private readonly events: WhatsappEventsBus,
    private readonly waha: WahaProvider,
    private readonly bot: WhatsappBotService,
  ) {}

  @Public()
  @Post('waha')
  @HttpCode(200)
  async receiveWaha(@Req() req: RawBodyRequest<Request>) {
    return this.handle(req);
  }

  @Public()
  @Post('evolution')
  @HttpCode(200)
  async receiveLegacy(@Req() req: RawBodyRequest<Request>) {
    return this.handle(req);
  }

  private async handle(req: RawBodyRequest<Request>) {
    const body: any = req.body ?? {};
    const session: string = body?.session ?? '';

    if (!session || !/^[A-Za-z0-9._-]{1,128}$/.test(session)) {
      this.logger.warn(`Webhook WAHA com session inválida: ${session}`);
      return { ok: false, reason: 'no session' };
    }

    const inst = await this.instances.findByInstanceName(session);
    if (!inst) {
      // 403 opaco — não vaza quais sessões existem.
      throw new ForbiddenException('Invalid webhook');
    }

    const dInst = this.instances.decrypt(inst);
    const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(body));
    const headers = req.headers as Record<string, string | undefined>;
    if (!this.waha.verifyWebhook(dInst, headers, rawBody)) {
      throw new ForbiddenException('Invalid webhook signature');
    }

    try {
      const tenantId = inst.tenantId;
      for (const ev of this.waha.parseWebhook(body)) {
        if (ev.kind === 'message') {
          const m = ev.data;
          // Grupos só entram se a instância tiver a captura ligada (opt-in).
          if (m.isGroup && !inst.captureGroups) continue;
          if (m.media?.url && !m.media.data) {
            const dl = await this.waha.downloadMedia(dInst, { url: m.media.url });
            if (dl) {
              m.media.data = dl.base64;
              m.media.mime = dl.mime;
            }
          }
          const r = await this.messages.ingestMessage(inst.id, tenantId, m);
          // Mensagem NOVA do cliente (não eco, não grupo) → aciona o chatbot.
          if (r?.created && m.direction === 'IN' && !m.isGroup) {
            void this.bot.onInbound(tenantId, r.conversationId);
          }
        } else if (ev.kind === 'status') {
          await this.messages.ingestStatus(tenantId, ev.data);
        } else if (ev.kind === 'connection') {
          const updated = await this.instances.updateConnectionState(session, ev.data.state, {
            ...(ev.data.phoneE164 ? { phoneE164: ev.data.phoneE164 } : {}),
          });
          if (updated) {
            this.events.emit({
              type: 'instance.updated',
              tenantId,
              payload: {
                id: updated.id,
                status: updated.status,
                phoneE164: updated.phoneE164,
                qrCode: updated.qrCode,
              },
            });
          }
        }
      }
    } catch (e) {
      this.logger.error(`Erro processando webhook WAHA: ${(e as Error).message}`, (e as Error).stack);
    }

    return { ok: true };
  }
}
