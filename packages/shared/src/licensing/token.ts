import { createPublicKey, verify as edVerify } from 'node:crypto';

import type { ModuleCode } from './modules';
import { LICENSE_PUBLIC_KEY_SPKI_B64 } from './public-key';

/**
 * Token de licença NetX — JWS compacto assinado em EdDSA (Ed25519) pelo Hub.
 *
 * Formato: `base64url(header).base64url(payload).base64url(signature)`.
 * O cliente valida a assinatura com a chave pública embutida (public-key.ts) e
 * NUNCA precisa falar com o Hub pra isso — a validação é 100% local. Ver
 * docs/licensing.md.
 */

export const LICENSE_TOKEN_TYP = 'netx-lic';
export const LICENSE_TOKEN_ISS = 'netx-hub';
/** Validade que o Hub deve carimbar em cada token renovado pelo heartbeat. */
export const LICENSE_TOKEN_TTL_DAYS = 7;

export type LicenseStatus = 'ACTIVE' | 'BLOCKED' | 'SUSPENDED';
/** Degrau de bloqueio aplicado quando a licença não está ACTIVE. */
export type LicenseBlockMode = 'UI_ONLY' | 'UI_AND_PROVISIONING';

export interface LicenseClaims {
  iss: string; // "netx-hub"
  sub: string; // instanceId
  status: LicenseStatus;
  plan: string;
  /** Teto contratado de contratos ativos (0 = ilimitado). Informativo. */
  maxContracts: number;
  blockMode: LicenseBlockMode;
  iat: number; // epoch segundos
  exp: number; // epoch segundos
  /** Até quando mostrar só banner antes de travar de fato (epoch s). */
  graceUntil?: number;
  /**
   * Códigos de módulo habilitados (catálogo em modules.ts). Ausente/vazio ⇒
   * catálogo inteiro habilitado (instância legada tudo-ligada). Ver
   * entitledModules() e docs/ecosystem/ECOSYSTEM-MODULAR-PLAN.md.
   */
  modules?: ModuleCode[];
}

export interface LicenseVerifyOk {
  ok: true;
  claims: LicenseClaims;
}
export interface LicenseVerifyErr {
  ok: false;
  /** Motivo legível — vai pro license_state.lastError, não pro usuário final. */
  reason: string;
}
export type LicenseVerifyResult = LicenseVerifyOk | LicenseVerifyErr;

function b64urlToBuf(s: string): Buffer {
  // base64url → base64 (com padding) → Buffer
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  return Buffer.from(b64 + pad, 'base64');
}

let cachedKey: ReturnType<typeof createPublicKey> | null = null;
function publicKey() {
  if (!cachedKey) {
    cachedKey = createPublicKey({
      key: Buffer.from(LICENSE_PUBLIC_KEY_SPKI_B64, 'base64'),
      format: 'der',
      type: 'spki',
    });
  }
  return cachedKey;
}

function isClaims(v: unknown): v is LicenseClaims {
  if (!v || typeof v !== 'object') return false;
  const c = v as Record<string, unknown>;
  return (
    typeof c.iss === 'string' &&
    typeof c.sub === 'string' &&
    (c.status === 'ACTIVE' || c.status === 'BLOCKED' || c.status === 'SUSPENDED') &&
    typeof c.plan === 'string' &&
    typeof c.maxContracts === 'number' &&
    (c.blockMode === 'UI_ONLY' || c.blockMode === 'UI_AND_PROVISIONING') &&
    typeof c.iat === 'number' &&
    typeof c.exp === 'number' &&
    // `modules` é opcional (compat legado): se vier, precisa ser array de strings.
    (c.modules === undefined ||
      (Array.isArray(c.modules) && c.modules.every((m) => typeof m === 'string')))
  );
}

/**
 * Verifica a assinatura e o shape do token. NÃO valida expiração — isso é
 * decisão do guard (ver licenseDecision), porque um token expirado ainda é
 * "autêntico" e queremos diferenciar "expirou" de "forjado/corrompido".
 */
export function verifyLicenseToken(token: string): LicenseVerifyResult {
  if (typeof token !== 'string' || token.length < 16 || token.length > 8192) {
    return { ok: false, reason: 'token ausente ou tamanho inválido' };
  }
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'formato JWS inválido' };
  const [h, p, s] = parts;

  let header: { alg?: string; typ?: string };
  let claims: unknown;
  try {
    header = JSON.parse(b64urlToBuf(h).toString('utf8'));
    claims = JSON.parse(b64urlToBuf(p).toString('utf8'));
  } catch {
    return { ok: false, reason: 'header/payload não é JSON válido' };
  }

  if (header.alg !== 'EdDSA' || header.typ !== LICENSE_TOKEN_TYP) {
    return { ok: false, reason: 'header alg/typ inesperado' };
  }

  let signatureOk = false;
  try {
    signatureOk = edVerify(
      null, // EdDSA não usa hash externo
      Buffer.from(`${h}.${p}`),
      publicKey(),
      b64urlToBuf(s),
    );
  } catch {
    return { ok: false, reason: 'falha ao verificar assinatura' };
  }
  if (!signatureOk) return { ok: false, reason: 'assinatura inválida' };

  if (!isClaims(claims)) return { ok: false, reason: 'claims incompletas' };
  if (claims.iss !== LICENSE_TOKEN_ISS) {
    return { ok: false, reason: `issuer inesperado: ${claims.iss}` };
  }
  return { ok: true, claims };
}

export type LicenseEffect =
  | 'ALLOW' // licença ativa e válida
  | 'GRACE' // problema, mas dentro do período de graça → banner, sem travar
  | 'BLOCK_UI' // trava o painel (rotas de operador → 402)
  | 'BLOCK_UI_PROVISIONING'; // trava painel + provisionamento de novos clientes

export interface LicenseDecision {
  effect: LicenseEffect;
  status: LicenseStatus | 'NONE';
  reason: string;
  expiresAt: number | null; // epoch s
}

/**
 * Decide o efeito da licença a partir de um token já verificado (ou ausente),
 * dado o instante atual. Pura — sem I/O — pra ser testável e usada igual no
 * guard e na tela. `nowSeconds` em epoch segundos.
 */
export function licenseDecision(
  verify: LicenseVerifyResult | null,
  nowSeconds: number,
): LicenseDecision {
  // Sem token verificável: tratamos como bloqueio de UI (o guard só chega aqui
  // quando o licenciamento está LIGADO; desligado é short-circuit antes).
  if (!verify || !verify.ok) {
    return {
      effect: 'BLOCK_UI',
      status: 'NONE',
      reason: verify?.ok === false ? verify.reason : 'sem licença',
      expiresAt: null,
    };
  }
  const c = verify.claims;
  const blockEffect: LicenseEffect =
    c.blockMode === 'UI_AND_PROVISIONING' ? 'BLOCK_UI_PROVISIONING' : 'BLOCK_UI';

  if (c.status === 'BLOCKED' || c.status === 'SUSPENDED') {
    return { effect: blockEffect, status: c.status, reason: `status ${c.status}`, expiresAt: c.exp };
  }
  // status ACTIVE: vale enquanto não expirou.
  if (nowSeconds <= c.exp) {
    return { effect: 'ALLOW', status: 'ACTIVE', reason: 'ativa', expiresAt: c.exp };
  }
  // Expirou (perdeu contato com o Hub além do TTL). Período de graça opcional.
  if (c.graceUntil && nowSeconds <= c.graceUntil) {
    return { effect: 'GRACE', status: 'ACTIVE', reason: 'expirada, em graça', expiresAt: c.exp };
  }
  return { effect: blockEffect, status: 'ACTIVE', reason: 'licença expirada', expiresAt: c.exp };
}
