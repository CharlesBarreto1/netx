import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { Public } from '../../common/decorators';

import { EfiChargesService } from './efi-charges.service';

/**
 * Webhooks do EFI — PÚBLICOS (sem JWT). A autenticidade vem de duas camadas:
 *   1. mTLS no Pix (configurado no proxy/Nginx que expõe a rota ao EFI).
 *   2. `token` aleatório no path (EfiConfig.webhookToken) que mapeia o tenant.
 *
 * O EFI (API Pix) ANEXA `/pix` à URL registrada. Por isso declaramos a rota
 * com e sem o sufixo `/pix`. Sempre respondemos 200 — erros são tratados
 * internamente pra não disparar retentativa infinita do EFI.
 */
@ApiTags('efi')
@Controller('efi/webhook')
export class EfiWebhookController {
  constructor(private readonly charges: EfiChargesService) {}

  // ── Pix ──────────────────────────────────────────────────────────────────
  @Public()
  @Post('pix/:token')
  @HttpCode(200)
  pix(@Param('token') token: string, @Body() body: unknown) {
    return this.charges.handlePixWebhook(token, body);
  }

  // EFI anexa "/pix" à URL registrada → captura a variante.
  @Public()
  @Post('pix/:token/pix')
  @HttpCode(200)
  pixAppended(@Param('token') token: string, @Body() body: unknown) {
    return this.charges.handlePixWebhook(token, body);
  }

  // ── Boleto / Cobranças ─────────────────────────────────────────────────────
  @Public()
  @Post('boleto/:token')
  @HttpCode(200)
  boleto(@Param('token') token: string, @Body() body: unknown) {
    return this.charges.handleBoletoNotification(token, body);
  }
}
