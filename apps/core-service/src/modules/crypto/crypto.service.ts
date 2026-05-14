/**
 * CryptoService — AES-256-GCM com KMS_MASTER_KEY.
 *
 * Formato do ciphertext (string Base64URL única, fácil de armazenar em coluna TEXT):
 *
 *   v1:<iv_b64>:<tag_b64>:<ciphertext_b64>
 *
 * Versão prefixada permite migração futura (v2: nonce maior, AEAD diferente).
 * IV de 12 bytes (NIST recomenda pra GCM). Tag de 16 bytes (default).
 *
 * Threat model:
 *   - Atacante com leitura do DB (SQL injection, backup vazado) NÃO consegue
 *     decifrar sem KMS_MASTER_KEY (que vive em /etc/netx/.secrets, modo 0640).
 *   - Atacante com root no host consegue tudo. Não tentamos proteger disso.
 *
 * Trade-off explícito: NÃO rotacionamos KMS_MASTER_KEY. Em caso de
 * comprometimento, plano é re-cadastrar todas as senhas manualmente.
 */
import { Injectable, OnModuleInit } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;   // NIST-recommended pra GCM
const TAG_LENGTH = 16;  // default GCM tag
const VERSION = 'v1';

@Injectable()
export class CryptoService implements OnModuleInit {
  private masterKey!: Buffer;

  onModuleInit(): void {
    const raw = process.env.KMS_MASTER_KEY;
    if (!raw || !/^[0-9a-f]{64}$/i.test(raw)) {
      throw new Error(
        'KMS_MASTER_KEY ausente ou inválido — esperado hex de 64 chars (256 bits). ' +
          'Gere com `openssl rand -hex 32` e cole no .env.',
      );
    }
    this.masterKey = Buffer.from(raw, 'hex');
  }

  /**
   * Cifra plaintext UTF-8. Retorna string `v1:<iv>:<tag>:<ct>` em Base64URL.
   * Idempotente em sentido prático: cada call gera IV novo (não-determinístico).
   */
  encrypt(plaintext: string): string {
    if (plaintext === '') return '';
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.masterKey, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      VERSION,
      iv.toString('base64url'),
      tag.toString('base64url'),
      ct.toString('base64url'),
    ].join(':');
  }

  /**
   * Decifra ciphertext gerado por `encrypt`. Lança se versão desconhecida ou
   * autenticação GCM falha (tampering / chave errada).
   */
  decrypt(ciphertext: string): string {
    if (ciphertext === '' || ciphertext == null) return '';
    const parts = ciphertext.split(':');
    if (parts.length !== 4) {
      throw new Error('CryptoService.decrypt: formato inválido (esperado v1:iv:tag:ct)');
    }
    const [version, ivB64, tagB64, ctB64] = parts;
    if (version !== VERSION) {
      throw new Error(`CryptoService.decrypt: versão "${version}" desconhecida`);
    }
    const iv = Buffer.from(ivB64, 'base64url');
    const tag = Buffer.from(tagB64, 'base64url');
    const ct = Buffer.from(ctB64, 'base64url');
    if (iv.length !== IV_LENGTH) {
      throw new Error(`CryptoService.decrypt: IV size inválido (${iv.length})`);
    }
    if (tag.length !== TAG_LENGTH) {
      throw new Error(`CryptoService.decrypt: tag size inválido (${tag.length})`);
    }
    const decipher = createDecipheriv(ALGORITHM, this.masterKey, iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return pt.toString('utf8');
  }

  /**
   * Helper pra encrypt opcional: null/undefined/'' passam direto, demais cifram.
   * Usado em camada de write do Prisma pra evitar boilerplate.
   */
  encryptOptional(plaintext: string | null | undefined): string | null {
    if (plaintext == null || plaintext === '') return null;
    return this.encrypt(plaintext);
  }

  /**
   * Helper pra decrypt opcional: null/undefined/'' viram null, demais decifram.
   * Não lança em caso de string vazia.
   */
  decryptOptional(ciphertext: string | null | undefined): string | null {
    if (ciphertext == null || ciphertext === '') return null;
    return this.decrypt(ciphertext);
  }
}
