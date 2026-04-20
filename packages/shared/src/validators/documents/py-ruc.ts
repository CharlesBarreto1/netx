import {
  DocumentValidationResult,
  DocumentValidator,
  digitsOnly,
} from './types';

/**
 * Validador do RUC (Registro Único del Contribuyente) — Paraguay.
 *
 * Estrutura: <base de 1..8 dígitos>-<DV de 1 dígito>.
 * Algoritmo do dígito verificador (módulo 11 com pesos descendentes
 * partindo de 2 pelo lado direito da base):
 *
 *   - Inverte a base.
 *   - Multiplica cada dígito pelo peso 2,3,4,5,6,7,2,3,... cíclico.
 *   - Soma os produtos.
 *   - r = soma % 11.
 *   - DV = if r === 0 then 0 else if r === 1 then 0 else 11 - r.
 *
 * Algumas implementações usam pesos 2..7 sem ciclar (RUCs paraguaios
 * raramente passam de 8 dígitos de base, então o limite cai dentro de 2..9).
 * Mantemos a versão cíclica por segurança em RUCs longos.
 *
 * Formato exibição: 80018923-1
 */
function calcCheckDigit(base: string): number {
  const reversed = base.split('').reverse().map(Number);
  let weight = 2;
  let sum = 0;
  for (const digit of reversed) {
    sum += digit * weight;
    weight = weight === 7 ? 2 : weight + 1;
  }
  const r = sum % 11;
  if (r <= 1) return 0;
  return 11 - r;
}

export const pyRucValidator: DocumentValidator = {
  type: 'RUC',
  country: 'PY',
  validate(value: string): DocumentValidationResult {
    // Aceita "80018923-1", "80018923-1", "800189231"
    const raw = (value ?? '').trim();
    const m = raw.match(/^(\d{1,8})-?(\d)$/);
    if (!m) {
      return {
        valid: false,
        normalized: digitsOnly(raw),
        formatted: '',
        reason: 'RUC deve ter formato <base>-<DV> (até 8 dígitos + 1 DV)',
      };
    }

    const base = m[1];
    const informedDv = Number(m[2]);
    const expectedDv = calcCheckDigit(base);

    if (informedDv !== expectedDv) {
      return {
        valid: false,
        normalized: `${base}${informedDv}`,
        formatted: '',
        reason: `Dígito verificador inválido (esperado ${expectedDv})`,
      };
    }

    return {
      valid: true,
      normalized: `${base}${informedDv}`,
      formatted: `${base}-${informedDv}`,
    };
  },
};
