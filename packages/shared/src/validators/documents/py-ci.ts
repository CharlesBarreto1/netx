import {
  DocumentValidationResult,
  DocumentValidator,
  digitsOnly,
} from './types';

/**
 * Validador da Cédula de Identidad (CI) — Paraguay.
 *
 * A CI paraguaia (emitida pela Policía Nacional) historicamente NÃO carrega
 * dígito verificador público. A validação aqui é estrutural:
 *   - Apenas dígitos
 *   - Comprimento entre 6 e 9 (compatível com numerações antigas e modernas)
 *   - Não pode ser tudo o mesmo dígito (heurística anti-fraude)
 *
 * Formato exibição: agrupado em milhares com pontos (ex.: 4.123.456).
 */
function format(d: string): string {
  // Insere ponto a cada 3 dígitos da direita pra esquerda
  return d.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export const pyCiValidator: DocumentValidator = {
  type: 'CI',
  country: 'PY',
  validate(value: string): DocumentValidationResult {
    const d = digitsOnly(value);

    if (d.length < 6 || d.length > 9) {
      return { valid: false, normalized: d, formatted: '', reason: 'CI deve ter entre 6 e 9 dígitos' };
    }
    if (/^(\d)\1+$/.test(d)) {
      return { valid: false, normalized: d, formatted: '', reason: 'CI com todos os dígitos iguais é inválido' };
    }

    return { valid: true, normalized: d, formatted: format(d) };
  },
};
