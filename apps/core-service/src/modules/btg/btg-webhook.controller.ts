import { Body, Controller, Headers, HttpCode, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { Public } from '../../common/decorators';

import { BtgChargesService } from './btg-charges.service';
import { BtgConfigService } from './btg-config.service';
import { BtgRecurrenceService } from './btg-recurrence.service';
import type { BtgWebhookEvent } from './btg.types';

/**
 * Webhook do BTG — PÚBLICO (sem JWT). Duas camadas de defesa:
 *   1. `token` aleatório no path (BtgConfig.webhookToken) → mapeia o tenant.
 *   2. `Authorization: Bearer <secret>` que o BTG envia (o secret que
 *      registramos). Validamos contra o secret cifrado do tenant.
 *
 * Sempre responde 200 — erros são tratados internamente (sem retry infinito).
 * O envelope é { webhookId, event, data }; despachamos pra cobranças e
 * recorrências (cada handler casa só os recursos que conhece).
 */
@ApiTags('btg')
@Controller('btg/webhook')
export class BtgWebhookController {
  constructor(
    private readonly config: BtgConfigService,
    private readonly charges: BtgChargesService,
    private readonly recurrence: BtgRecurrenceService,
  ) {}

  @Public()
  @Post(':token')
  @HttpCode(200)
  async handle(
    @Param('token') token: string,
    @Headers('authorization') auth: string | undefined,
    @Body() body: BtgWebhookEvent,
  ): Promise<{ ok: boolean }> {
    const cfg = await this.config.findByWebhookToken(token);
    if (!cfg) return { ok: true }; // token desconhecido → ignora

    // Valida o Bearer secret (quando há secret registrado).
    const secret = this.config.webhookSecret(cfg);
    if (secret) {
      const provided = (auth ?? '').replace(/^Bearer\s+/i, '').trim();
      if (provided !== secret) return { ok: true }; // não autêntico → ignora silenciosamente
    }

    await this.charges.handleWebhook(cfg.tenantId, body);
    await this.recurrence.handleWebhook(cfg.tenantId, body);
    return { ok: true };
  }
}
