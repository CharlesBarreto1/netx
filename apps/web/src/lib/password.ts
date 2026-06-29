/**
 * Espelho da política de senha do backend (`@netx/shared/auth/password`).
 * Mantemos uma cópia local enxuta pra evitar import cross-package no client.
 */
export const PASSWORD_RULES = {
  minLength: 8,
  hasLower: /[a-z]/u,
  hasUpper: /[A-Z]/u,
  hasDigit: /[0-9]/u,
  hasSpecial: /[^A-Za-z0-9]/u,
};

/**
 * `id` é a chave i18n da regra (namespace `auth.firstLogin`), igual às usadas
 * pela tela `/first-login`. O componente de UI resolve via `t(id)` — assim o
 * checklist segue o seletor de idioma sem texto cravado.
 */
export type PasswordCheckId =
  | 'checkMinLength'
  | 'checkUpper'
  | 'checkLower'
  | 'checkDigit'
  | 'checkSymbol';

export interface PasswordCheckResult {
  ok: boolean;
  checks: { id: PasswordCheckId; ok: boolean }[];
}

export function checkPassword(value: string): PasswordCheckResult {
  const v = value ?? '';
  const checks: { id: PasswordCheckId; ok: boolean }[] = [
    { id: 'checkMinLength', ok: v.length >= PASSWORD_RULES.minLength },
    { id: 'checkUpper', ok: PASSWORD_RULES.hasUpper.test(v) },
    { id: 'checkLower', ok: PASSWORD_RULES.hasLower.test(v) },
    { id: 'checkDigit', ok: PASSWORD_RULES.hasDigit.test(v) },
    { id: 'checkSymbol', ok: PASSWORD_RULES.hasSpecial.test(v) },
  ];
  return { ok: checks.every((c) => c.ok), checks };
}
