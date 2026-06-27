import { Injectable, Logger } from '@nestjs/common';
import type { WhatsappInstance } from '@prisma/client';

import { CryptoService } from '../../crypto/crypto.service';

import type { DecryptedInstance } from './channel-provider';

/**
 * Decifra os segredos de uma WhatsappInstance (linha crua do Prisma) num
 * DecryptedInstance pronto para os providers. Ponto ÚNICO de decifragem — os
 * providers nunca tocam o CryptoService.
 *
 * Tolerância a legado: valores que não começam com `v1:` são tratados como
 * plaintext (instâncias Evolution antigas, pré-criptografia). Novos registros
 * sempre gravam cifrado.
 */
@Injectable()
export class WhatsappCredentials {
  private readonly logger = new Logger(WhatsappCredentials.name);

  constructor(private readonly crypto: CryptoService) {}

  private dec(value: string | null | undefined): string {
    if (!value) return '';
    if (!value.startsWith('v1:')) return value; // plaintext legado
    return this.crypto.decrypt(value);
  }

  decrypt(inst: WhatsappInstance): DecryptedInstance {
    let accessToken: string | null = null;
    let appSecret: string | null = null;
    if (inst.apiCredentialsEnc) {
      try {
        const raw = this.dec(inst.apiCredentialsEnc);
        const parsed = JSON.parse(raw) as { accessToken?: string; appSecret?: string };
        accessToken = parsed.accessToken ?? null;
        appSecret = parsed.appSecret ?? null;
      } catch (e) {
        this.logger.error(`apiCredentialsEnc inválido na instância ${inst.id}: ${(e as Error).message}`);
      }
    }

    return {
      id: inst.id,
      tenantId: inst.tenantId,
      channel: inst.channel,
      instanceName: inst.instanceName,
      phoneE164: inst.phoneE164,
      baseUrl: inst.evolutionUrl,
      apiKey: this.dec(inst.apiKey),
      webhookSecret: inst.webhookSecret,
      wabaId: inst.wabaId,
      phoneNumberId: inst.phoneNumberId,
      verifyToken: inst.verifyToken,
      accessToken,
      appSecret,
    };
  }
}
