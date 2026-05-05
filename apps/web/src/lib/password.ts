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

export interface PasswordCheckResult {
  ok: boolean;
  checks: { label: string; ok: boolean }[];
}

export function checkPassword(value: string): PasswordCheckResult {
  const v = value ?? '';
  const checks = [
    { label: `${PASSWORD_RULES.minLength}+ caracteres`, ok: v.length >= PASSWORD_RULES.minLength },
    { label: '1 maiúscula', ok: PASSWORD_RULES.hasUpper.test(v) },
    { label: '1 minúscula', ok: PASSWORD_RULES.hasLower.test(v) },
    { label: '1 número', ok: PASSWORD_RULES.hasDigit.test(v) },
    { label: '1 caractere especial', ok: PASSWORD_RULES.hasSpecial.test(v) },
  ];
  return { ok: checks.every((c) => c.ok), checks };
}
