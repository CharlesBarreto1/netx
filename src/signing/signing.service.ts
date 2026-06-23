import { Injectable, Logger } from '@nestjs/common';
import { createPrivateKey, sign as edSign, type KeyObject } from 'node:crypto';

import {
  LICENSE_TOKEN_ISS,
  LICENSE_TOKEN_TYP,
  type LicenseClaims,
} from './license-token';

/**
 * Assina tokens de licença (JWS compacto, EdDSA/Ed25519) com a chave privada do
 * Hub. O NetX cliente verifica a assinatura com a pública embutida. O formato
 * é idêntico ao de license-token.ts (e ao mint-dev do NetX) — qualquer
 * divergência faz a verificação no cliente falhar.
 *
 * A privada vem de LICENSE_PRIVATE_KEY_B64 (pkcs8/der base64). Sem ela, o Hub
 * NÃO assina (lança) — preferimos falhar visível a emitir token inválido.
 */
@Injectable()
export class SigningService {
  private readonly logger = new Logger(SigningService.name);
  private key: KeyObject | null = null;

  private privateKey(): KeyObject {
    if (this.key) return this.key;
    const b64 = process.env.LICENSE_PRIVATE_KEY_B64;
    if (!b64) {
      throw new Error(
        'LICENSE_PRIVATE_KEY_B64 ausente — o Hub não pode assinar licenças. ' +
          'Gere um par com `npm run keygen` e configure o .env.',
      );
    }
    this.key = createPrivateKey({
      key: Buffer.from(b64, 'base64'),
      format: 'der',
      type: 'pkcs8',
    });
    return this.key;
  }

  private static b64url(input: Buffer | string): string {
    return Buffer.from(input)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  /** Assina um conjunto de claims e devolve o token compacto. */
  sign(claims: LicenseClaims): string {
    const header = { alg: 'EdDSA', typ: LICENSE_TOKEN_TYP };
    const signingInput = `${SigningService.b64url(JSON.stringify(header))}.${SigningService.b64url(
      JSON.stringify(claims),
    )}`;
    const signature = edSign(null, Buffer.from(signingInput), this.privateKey());
    return `${signingInput}.${SigningService.b64url(signature)}`;
  }

  /**
   * Monta as claims a partir do estado da instância e assina. Centraliza a
   * política de validade (exp = agora + ttlDays) e graça (graceUntil = exp +
   * graceDays). nowMs injetável pra teste.
   */
  issue(params: {
    instanceId: string;
    status: LicenseClaims['status'];
    blockMode: LicenseClaims['blockMode'];
    plan: string;
    maxContracts: number;
    /** Códigos de módulo habilitados. Vazio/ausente ⇒ omitido (cliente: todos). */
    modules?: string[];
    ttlDays?: number;
    graceDays?: number;
    nowMs?: number;
  }): { token: string; claims: LicenseClaims } {
    const ttlDays = params.ttlDays ?? Number(process.env.LICENSE_TOKEN_TTL_DAYS ?? 7);
    const graceDays = params.graceDays ?? Number(process.env.LICENSE_GRACE_DAYS ?? 2);
    const now = Math.floor((params.nowMs ?? Date.now()) / 1000);
    const exp = now + ttlDays * 86400;
    const claims: LicenseClaims = {
      iss: LICENSE_TOKEN_ISS,
      sub: params.instanceId,
      status: params.status,
      plan: params.plan,
      maxContracts: params.maxContracts,
      blockMode: params.blockMode,
      iat: now,
      exp,
      graceUntil: exp + graceDays * 86400,
      // Só carimba quando há módulos: token sem o claim ⇒ cliente libera tudo
      // (legado). Mantém o token enxuto pra licenças "tudo incluso".
      ...(params.modules && params.modules.length ? { modules: params.modules } : {}),
    };
    return { token: this.sign(claims), claims };
  }
}
