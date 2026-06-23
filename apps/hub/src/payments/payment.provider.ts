import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';

import { isEfiReady } from '../efi/efi-config';
import { EfiClientService } from '../efi/efi-client.service';
import { PrismaService } from '../prisma/prisma.service';

export interface PaymentCharge {
  method: 'PIX';
  status: 'PENDING';
  /** Pix copia-e-cola (BR Code). */
  pixCopiaECola: string | null;
  /** data URL da imagem do QR. */
  qrImage: string | null;
  txid: string;
  expiresAt: string | null;
}

/**
 * Pagamento das faturas do Hub via EFI (Pix imediato). Se a EFI não estiver
 * configurada (EFI_ENABLED=false), recusa com mensagem orientando pagamento
 * por fora + baixa manual — o resto do sistema não muda.
 */
@Injectable()
export class PaymentProvider {
  constructor(
    private readonly prisma: PrismaService,
    private readonly efi: EfiClientService,
  ) {}

  /**
   * Cria (ou reusa) a cobrança Pix de uma fatura. Idempotente: se já há um Pix
   * vigente (não expirado), retorna o mesmo — não gera txid novo a cada clique.
   */
  async createPixCharge(invoiceId: string, method: 'PIX' | 'CARD'): Promise<PaymentCharge> {
    if (method !== 'PIX') {
      throw new BadRequestException('No momento só Pix está disponível.');
    }
    const cfg = this.efi.config();
    if (!isEfiReady(cfg)) {
      throw new ServiceUnavailableException(
        'Pagamento online ainda não ativado. Pague por Pix/transferência e a NetX ' +
          'confirma a baixa, ou contate a NetX.',
      );
    }

    const inv = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!inv) throw new BadRequestException('Fatura não encontrada');
    if (inv.status === 'PAID') throw new BadRequestException('Fatura já paga');

    // Reusa cobrança vigente.
    if (inv.pixTxid && inv.pixExpiresAt && inv.pixExpiresAt > new Date() && inv.pixCopiaECola) {
      return {
        method: 'PIX',
        status: 'PENDING',
        pixCopiaECola: inv.pixCopiaECola,
        qrImage: inv.pixQrImage,
        txid: inv.pixTxid,
        expiresAt: inv.pixExpiresAt.toISOString(),
      };
    }

    // txid BACEN: ^[a-zA-Z0-9]{26,35}$ — 32 hex serve.
    const txid = randomBytes(16).toString('hex');
    const amountReais = (inv.amountCents / 100).toFixed(2);
    const { pixCopiaECola, qrImage, txid: finalTxid } = await this.efi.createPixCob(
      cfg,
      txid,
      amountReais,
      `Fatura NetX ${inv.periodStart.toISOString().slice(0, 7)}`,
    );
    const expiresAt = new Date(Date.now() + cfg.expirationDays * 86_400_000);
    await this.prisma.invoice.update({
      where: { id: invoiceId },
      data: { pixTxid: finalTxid, pixCopiaECola, pixQrImage: qrImage, pixExpiresAt: expiresAt },
    });
    return {
      method: 'PIX',
      status: 'PENDING',
      pixCopiaECola,
      qrImage,
      txid: finalTxid,
      expiresAt: expiresAt.toISOString(),
    };
  }
}
