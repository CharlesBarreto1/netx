/**
 * Espelho client-side da política de senha Wi-Fi do backend
 * (`@netx/shared` → WifiPasswordSchema / WIFI_PASSWORD_RULES). Cópia local
 * enxuta pra checklist visual + gerador, sem import cross-package no client.
 *
 * MANTER EM SINCRONIA com packages/shared/src/provisioning/types.ts.
 */
export const WIFI_PASSWORD_RULES = {
  minLength: 8,
  maxLength: 63,
  /** ASCII imprimível, sem espaço (0x20) — evita acentos/controle. */
  charset: /^[\x21-\x7E]+$/u,
  hasLower: /[a-z]/u,
  hasUpper: /[A-Z]/u,
  hasDigit: /[0-9]/u,
  hasSpecial: /[^A-Za-z0-9]/u,
};

/**
 * `id` é a chave i18n da regra (namespace `wifiPassword`). O componente de UI
 * resolve via `t(id)` — o checklist segue o seletor de idioma sem texto cravado.
 */
export type WifiPasswordCheckId =
  | 'checkMinLength'
  | 'checkUpper'
  | 'checkLower'
  | 'checkDigit'
  | 'checkSymbol'
  | 'checkCharset';

export interface WifiPasswordCheckResult {
  ok: boolean;
  checks: { id: WifiPasswordCheckId; ok: boolean }[];
}

export function checkWifiPassword(value: string): WifiPasswordCheckResult {
  const v = value ?? '';
  const checks: { id: WifiPasswordCheckId; ok: boolean }[] = [
    {
      id: 'checkMinLength',
      ok: v.length >= WIFI_PASSWORD_RULES.minLength && v.length <= WIFI_PASSWORD_RULES.maxLength,
    },
    { id: 'checkUpper', ok: WIFI_PASSWORD_RULES.hasUpper.test(v) },
    { id: 'checkLower', ok: WIFI_PASSWORD_RULES.hasLower.test(v) },
    { id: 'checkDigit', ok: WIFI_PASSWORD_RULES.hasDigit.test(v) },
    { id: 'checkSymbol', ok: WIFI_PASSWORD_RULES.hasSpecial.test(v) },
    { id: 'checkCharset', ok: v.length > 0 && WIFI_PASSWORD_RULES.charset.test(v) },
  ];
  return { ok: checks.every((c) => c.ok), checks };
}

/**
 * Gera uma senha Wi-Fi que já satisfaz a política forte: garante 1 maiúscula,
 * 1 minúscula, 1 dígito e 1 símbolo, sem caracteres ambíguos (0/O, 1/l/I) nem
 * símbolos ruins de ditar. Usa um subconjunto de símbolos seguro pra ONTs.
 */
export function generateWifiPassword(length = 14): string {
  const lower = 'abcdefghijkmnpqrstuvwxyz'; // sem l
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // sem I, O
  const digit = '23456789'; // sem 0, 1
  const special = '!@#$%*_-+=?'; // subconjunto seguro pra ONTs e fácil de ditar
  const all = lower + upper + digit + special;
  const size = Math.max(length, WIFI_PASSWORD_RULES.minLength);

  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  const pick = (set: string, i: number) => set[bytes[i] % set.length];

  // 1 de cada classe obrigatória + resto do alfabeto completo.
  const chars: string[] = [pick(lower, 0), pick(upper, 1), pick(digit, 2), pick(special, 3)];
  for (let i = 4; i < size; i++) chars.push(pick(all, i));

  // Fisher-Yates com bytes aleatórios pra não fixar as 4 classes no início.
  const shuffle = new Uint8Array(chars.length);
  crypto.getRandomValues(shuffle);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = shuffle[i] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}
