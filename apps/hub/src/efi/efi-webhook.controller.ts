import {
  Body,
  Controller,
  HttpCode,
  Logger,
  Param,
  Post,
} from '@nestjs/common';

import { BillingService } from '../billing/billing.service';
import { loadEfiConfig } from './efi-config';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Webhook da EFI (Pix). Público — a EFI chama direto. Segurança em camadas:
 *   - mTLS no proxy (nginx) que expõe esta rota só pra EFI;
 *   - token aleatório no path (EFI_WEBHOOK_TOKEN).
 * Sempre responde 200 (evita retentativa infinita), mesmo quando ignora.
 */
@Controller('efi/webhook')
export class EfiWebhookController {
  private readonly logger = new Logger(EfiWebhookController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
  ) {}

  @Post('pix/:token')
  @HttpCode(200)
  async pix(@Param('token') token: string, @Body() body: unknown): Promise<{ ok: true }> {
    const cfg = loadEfiConfig();
    if (!cfg.webhookToken || token !== cfg.webhookToken) {
      this.logger.warn('Webhook Pix com token inválido — ignorado');
      return { ok: true };
    }
    const items = Array.isArray((body as { pix?: unknown[] })?.pix)
      ? (body as { pix: Array<Record<string, unknown>> }).pix
      : [];
    for (const item of items) {
      const txid = typeof item.txid === 'string' ? item.txid : null;
      if (!txid) continue;
      const inv = await this.prisma.invoice.findUnique({ where: { pixTxid: txid } });
      if (!inv || inv.status === 'PAID') continue;
      const e2e = typeof item.endToEndId === 'string' ? item.endToEndId : undefined;
      const valor = typeof item.valor === 'string' ? Math.round(Number(item.valor) * 100) : undefined;
      await this.billing.markPaid(inv.id, { method: 'PIX', ref: e2e, amountCents: valor });
      this.logger.log(`Pix baixado: fatura=${inv.id} txid=${txid}`);
    }
    return { ok: true };
  }
}
