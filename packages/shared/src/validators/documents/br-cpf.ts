import {
  DocumentValidationResult,
  DocumentValidator,
  digitsOnly,
} from './types';

/**
 * Validador de CPF (Cadastro de Pessoas Físicas — Brasil).
 *
 * Algoritmo: módulo 11 dos 9 primeiros dígitos para gerar o 1º DV;
 *            módulo 11 dos 10 primeiros dígitos para gerar o 2º DV.
 * Sequências triviais (00000000000 ... 99999999999) são rejeitadas.
 *
 * Formato canônico: 11 dígitos. Formato exibição: 000.000.000-00
 */
function checkDigit(numbers: number[], factorStart: number): number {
  const sum = numbers.reduce(
    (acc, digit, i) => acc + digit * (factorStart - i),
    0,
  );
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

function format(d: string): string {
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9, 11)}`;
}

export const brCpfValidator: DocumentValidator = {
  type: 'CPF',
  country: 'BR',
  validate(value: string): DocumentValidationResult {
    const d = digitsOnly(value);

    if (d.length !== 11) {
      return { valid: false, normalized: d, formatted: '', reason: 'CPF deve ter 11 dígitos' };
    }
    if (/^(\d)\1{10}$/.test(d)) {
      return { valid: false, normalized: d, formatted: '', reason: 'CPF com todos os dígitos iguais é inválido' };
    }

    const nums = d.split('').map(Number);
    const dv1 = checkDigit(nums.slice(0, 9), 10);
    const dv2 = checkDigit(nums.slice(0, 10), 11);

    if (dv1 !== nums[9] || dv2 !== nums[10]) {
      return { valid: false, normalized: d, formatted: '', reason: 'Dígito verificador inválido' };
    }

    return { valid: true, normalized: d, formatted: format(d) };
  },
};
