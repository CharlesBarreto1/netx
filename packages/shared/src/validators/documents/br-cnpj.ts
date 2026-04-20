import {
  DocumentValidationResult,
  DocumentValidator,
  digitsOnly,
} from './types';

/**
 * Validador de CNPJ (Cadastro Nacional da Pessoa Jurídica — Brasil).
 *
 * Algoritmo: módulo 11 com pesos cíclicos.
 *   - 1º DV: pesos [5,4,3,2,9,8,7,6,5,4,3,2] sobre os 12 primeiros dígitos
 *   - 2º DV: pesos [6,5,4,3,2,9,8,7,6,5,4,3,2] sobre os 13 primeiros dígitos
 *
 * Formato canônico: 14 dígitos. Formato exibição: 00.000.000/0000-00
 */
const W1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const W2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

function checkDigit(digits: number[], weights: number[]): number {
  const sum = digits.reduce((acc, d, i) => acc + d * weights[i], 0);
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

function format(d: string): string {
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12, 14)}`;
}

export const brCnpjValidator: DocumentValidator = {
  type: 'CNPJ',
  country: 'BR',
  validate(value: string): DocumentValidationResult {
    const d = digitsOnly(value);

    if (d.length !== 14) {
      return { valid: false, normalized: d, formatted: '', reason: 'CNPJ deve ter 14 dígitos' };
    }
    if (/^(\d)\1{13}$/.test(d)) {
      return { valid: false, normalized: d, formatted: '', reason: 'CNPJ com todos os dígitos iguais é inválido' };
    }

    const nums = d.split('').map(Number);
    const dv1 = checkDigit(nums.slice(0, 12), W1);
    const dv2 = checkDigit(nums.slice(0, 13), W2);

    if (dv1 !== nums[12] || dv2 !== nums[13]) {
      return { valid: false, normalized: d, formatted: '', reason: 'Dígito verificador inválido' };
    }

    return { valid: true, normalized: d, formatted: format(d) };
  },
};
