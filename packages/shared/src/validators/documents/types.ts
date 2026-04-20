/**
 * Documento de identificação fiscal/civil de uma pessoa física ou jurídica.
 * O conjunto cresce conforme novos países entram (ver `validateDocument`).
 */
export type DocumentType =
  // Brasil
  | 'CPF'
  | 'CNPJ'
  // Paraguay
  | 'CI'
  | 'RUC'
  // Placeholders (sem validador implementado ainda)
  | 'VAT'
  | 'NIF'
  | 'RFC'
  | 'CUIT'
  | 'RUT'
  | 'NIT'
  | 'SSN'
  | 'EIN'
  | 'OTHER';

/** ISO 3166-1 alpha-2 country code. */
export type CountryCode = string;

export interface DocumentValidationResult {
  valid: boolean;
  /** Versão normalizada (apenas dígitos / formato canônico). Quando inválido, o input original. */
  normalized: string;
  /** Versão formatada para exibição (com máscara). Vazio quando inválido. */
  formatted: string;
  /** Mensagem amigável quando `valid === false`. */
  reason?: string;
}

/** Implementado por cada validador específico de país/tipo. */
export interface DocumentValidator {
  type: DocumentType;
  country: CountryCode;
  validate(value: string): DocumentValidationResult;
}

/** Erro lançado quando o tipo solicitado não tem validador registrado. */
export class UnsupportedDocumentTypeError extends Error {
  constructor(country: CountryCode, type: DocumentType) {
    super(`No document validator registered for ${country}/${type}`);
    this.name = 'UnsupportedDocumentTypeError';
  }
}

/** Remove tudo que não é dígito. */
export function digitsOnly(value: string): string {
  return (value ?? '').replace(/\D+/g, '');
}
