import {
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Logger,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';

import { Public } from '../../common/decorators';

import { MetaCloudProvider } from './providers/meta-cloud.provider';
import { WhatsappInstancesService } from './whatsapp-instances.service';
import { WhatsappMessagesService } from './whatsapp-messages.service';

/**
 * Webhook receiver do canal oficial Meta Cloud API.
 *
 * Rotas:
 *   GET  /v1/webhooks/meta   — verificação (hub.challenge) na configuração
 *   POST /v1/webhooks/meta   — eventos (mensagens/status), assinados HMAC-256
 *
 * Roteamento por `value.metadata.phone_number_id` → instância → tenant. A
 * assinatura `X-Hub-Signature-256` é validada com o `appSecret` DA INSTÂNCIA
 * encontrada, ANTES de processar (sobre o corpo cru, req.rawBody).
 *
 * Resposta SEMPRE 200 — Meta reentrega em não-200.
 */
@ApiTags('webhooks')
@Controller('webhooks/meta')
export class WhatsappWebhookMetaController {
  private readonly logger = new Logger(WhatsappWebhookMetaController.name);

  constructor(
    private readonly instances: WhatsappInstancesService,
    private readonly messages: WhatsappMessagesService,
    private readonly meta: MetaCloudProvider,
  ) {}

  @Public()
  @Get()
  async verify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ) {
    if (mode !== 'subscribe' || !token) throw new ForbiddenException('Invalid verification');
    const inst = await this.instances.findByVerifyToken(token);
    if (!inst) throw new ForbiddenException('Invalid verify token');
    // Meta espera o challenge ecoado em text/plain.
    return challenge;
  }

  @Public()
  @Post()
  @HttpCode(200)
  async receive(@Req() req: RawBodyRequest<Request>) {
    const body: any = req.body ?? {};

    const phoneNumberId = extractPhoneNumberId(body);
    if (!phoneNumberId) {
      this.logger.warn('Webhook Meta sem phone_number_id — ignorando');
      return { ok: false, reason: 'no phone_number_id' };
    }

    const inst = await this.instances.findByPhoneNumberId(phoneNumberId);
    if (!inst) {
      throw new ForbiddenException('Invalid webhook'); // opaco
    }

    const dInst = this.instances.decrypt(inst);
    const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(body));
    const headers = req.headers as Record<string, string | undefined>;
    if (!this.meta.verifyWebhook(dInst, headers, rawBody)) {
      throw new ForbiddenException('Invalid webhook signature');
    }

    try {
      const tenantId = inst.tenantId; // tenant SEMPRE da instância, nunca do payload
      for (const ev of this.meta.parseWebhook(body)) {
        if (ev.kind === 'message') {
          const m = ev.data;
          if (m.media?.mediaId && !m.media.data) {
            const dl = await this.meta.downloadMedia(dInst, { mediaId: m.media.mediaId });
            if (dl) {
              m.media.data = dl.base64;
              m.media.mime = dl.mime;
            }
          }
          await this.messages.ingestMessage(inst.id, tenantId, m);
        } else if (ev.kind === 'status') {
          await this.messages.ingestStatus(tenantId, ev.data);
        }
      }
    } catch (e) {
      this.logger.error(`Erro processando webhook Meta: ${(e as Error).message}`, (e as Error).stack);
    }

    return { ok: true };
  }
}

/** Primeiro phone_number_id presente no payload da Meta. */
function extractPhoneNumberId(body: any): string | null {
  for (const entry of body?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const id = change?.value?.metadata?.phone_number_id;
      if (id) return String(id);
    }
  }
  return null;
}
