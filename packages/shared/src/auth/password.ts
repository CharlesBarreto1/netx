import { z } from 'zod';

/**
 * Política de senha forte.
 * Regras:
 *   - Mínimo 8 caracteres
 *   - 1+ letra maiúscula (A-Z)
 *   - 1+ letra minúscula (a-z)
 *   - 1+ número (0-9)
 *   - 1+ caractere especial (qualquer não-alfanumérico)
 *
 * Mensagens estruturadas — o frontend pode mostrar checklist visual.
 */
export const PASSWORD_RULES = {
  minLength: 8,
  hasLower: /[a-z]/u,
  hasUpper: /[A-Z]/u,
  hasDigit: /[0-9]/u,
  hasSpecial: /[^A-Za-z0-9]/u,
};

export interface PasswordValidationResult {
  ok: boolean;
  errors: string[];
}

/**
 * Valida senha contra a política. Retorna lista de mensagens (pra o front
 * exibir todas as falhas — não só a primeira).
 */
export function validateStrongPassword(value: string): PasswordValidationResult {
  const errors: string[] = [];
  if (!value || value.length < PASSWORD_RULES.minLength) {
    errors.push(`Mínimo ${PASSWORD_RULES.minLength} caracteres`);
  }
  if (!PASSWORD_RULES.hasUpper.test(value ?? '')) {
    errors.push('1 letra maiúscula');
  }
  if (!PASSWORD_RULES.hasLower.test(value ?? '')) {
    errors.push('1 letra minúscula');
  }
  if (!PASSWORD_RULES.hasDigit.test(value ?? '')) {
    errors.push('1 número');
  }
  if (!PASSWORD_RULES.hasSpecial.test(value ?? '')) {
    errors.push('1 caractere especial');
  }
  return { ok: errors.length === 0, errors };
}

/** Schema Zod que aplica a política. Usar em DTOs de senha. */
export const strongPasswordSchema = z
  .string()
  .min(PASSWORD_RULES.minLength, {
    message: `Mínimo ${PASSWORD_RULES.minLength} caracteres`,
  })
  .max(128)
  .refine((v) => PASSWORD_RULES.hasUpper.test(v), {
    message: 'Precisa de 1 letra maiúscula',
  })
  .refine((v) => PASSWORD_RULES.hasLower.test(v), {
    message: 'Precisa de 1 letra minúscula',
  })
  .refine((v) => PASSWORD_RULES.hasDigit.test(v), {
    message: 'Precisa de 1 número',
  })
  .refine((v) => PASSWORD_RULES.hasSpecial.test(v), {
    message: 'Precisa de 1 caractere especial',
  });
