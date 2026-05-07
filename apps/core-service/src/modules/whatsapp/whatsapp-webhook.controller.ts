import {
  Body,
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  Logger,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { Public } from '../../common/decorators';

import { WhatsappEventsBus } from './whatsapp-events.bus';
import { WhatsappInstancesService } from './whatsapp-instances.service';
import { WhatsappMessagesService } from './whatsapp-messages.service';

/**
 * Webhook receiver pra Evolution API.
 *
 * Endpoint registrado em cada instância:
 *   POST {WEBHOOK_BASE_URL}/v1/webhooks/evolution
 *
 * Autenticação: header `apikey: <webhookSecret>` configurado no `setWebhook`.
 * Validamos contra o registro local de instância (cada instância tem seu
 * próprio secret randômico).
 *
 * Eventos suportados:
 *   - MESSAGES_UPSERT       — nova mensagem (in/out)
 *   - MESSAGES_UPDATE       — status update (delivered/read)
 *   - CONNECTION_UPDATE     — open/close/connecting + QR
 *   - CONTACTS_UPSERT       — (ignorado no MVP — atualizamos contato no fluxo de msg)
 *
 * Resposta SEMPRE 200/204 — Evolution reentrega se receber 4xx/5xx,
 * causando duplicatas. Se algo der errado processando, log + 200.
 */
@ApiTags('webhooks')
@Controller('webhooks/evolution')
export class WhatsappWebhookController {
  private readonly logger = new Logger(WhatsappWebhookController.name);

  constructor(
    private readonly instances: WhatsappInstancesService,
    private readonly messages: WhatsappMessagesService,
    private readonly events: WhatsappEventsBus,
  ) {}

  @Public()
  @Post()
  @HttpCode(200)
  async receive(
    @Headers('apikey') apiKey: string | undefined,
    @Body() body: any,
  ) {
    const event: string = body?.event ?? '';
    const instanceName: string = body?.instance ?? '';

    if (!instanceName) {
      this.logger.warn('Webhook sem instance — ignorando');
      return { ok: false, reason: 'no instance' };
    }

    const inst = await this.instances.findByInstanceName(instanceName);
    if (!inst) {
      this.logger.warn(`Webhook pra instância desconhecida: ${instanceName}`);
      return { ok: false, reason: 'unknown instance' };
    }

    if (!apiKey || apiKey !== inst.webhookSecret) {
      this.logger.warn(`Webhook com secret inválido em ${instanceName}`);
      throw new ForbiddenException('Invalid webhook secret');
    }

    const data = body?.data ?? {};

    try {
      switch (event) {
        case 'messages.upsert':
        case 'MESSAGES_UPSERT':
          await this.handleMessagesUpsert(inst.id, inst.tenantId, data);
          break;

        case 'messages.update':
        case 'MESSAGES_UPDATE':
          await this.handleMessagesUpdate(inst.tenantId, data);
          break;

        case 'connection.update':
        case 'CONNECTION_UPDATE':
          await this.handleConnectionUpdate(inst.tenantId, instanceName, data);
          break;

        default:
          this.logger.debug(`Evento ignorado: ${event}`);
      }
    } catch (e) {
      this.logger.error(`Erro processando ${event}: ${(e as Error).message}`, (e as Error).stack);
      // Retornamos 200 mesmo com erro pra Evolution não reentregar (logamos pra debug)
    }

    return { ok: true };
  }

  private async handleMessagesUpsert(instanceId: string, tenantId: string, data: any) {
    // Evolution às vezes envia array, às vezes objeto único
    const items = Array.isArray(data) ? data : [data];
    for (const item of items) {
      await this.messages.handleIncoming(instanceId, tenantId, item);
    }
  }

  private async handleMessagesUpdate(tenantId: string, data: any) {
    const items = Array.isArray(data) ? data : [data];
    for (const item of items) {
      await this.messages.handleStatusUpdate(tenantId, item);
    }
  }

  private async handleConnectionUpdate(
    tenantId: string,
    instanceName: string,
    data: any,
  ) {
    const state: string | undefined = data?.state ?? data?.connection;
    let mapped: 'CONNECTED' | 'DISCONNECTED' | 'CONNECTING' | 'ERROR' = 'CONNECTING';
    if (state === 'open') mapped = 'CONNECTED';
    else if (state === 'close') mapped = 'DISCONNECTED';
    else if (state === 'connecting') mapped = 'CONNECTING';

    const phoneE164: string | null = data?.wuid
      ? '+' + String(data.wuid).split('@')[0]
      : data?.phone
      ? '+' + String(data.phone).replace(/\D/g, '')
      : null;
    const qrCode: string | null = data?.qrcode?.base64 ?? data?.qr ?? null;

    const updated = await this.instances.updateConnectionState(instanceName, mapped, {
      ...(phoneE164 ? { phoneE164 } : {}),
      ...(qrCode ? { qrCode } : {}),
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
