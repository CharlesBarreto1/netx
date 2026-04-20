/**
 * Registry plugável de validadores de documento por país.
 *
 * Adicionar um novo país/tipo:
 *   1) Criar arquivo `<cc>-<tipo>.ts` exportando um `DocumentValidator`.
 *   2) Importar aqui e adicionar ao `REGISTRY`.
 *   3) Adicionar testes em `__tests__/`.
 */
import { brCpfValidator } from './br-cpf';
import { brCnpjValidator } from './br-cnpj';
import { pyCiValidator } from './py-ci';
import { pyRucValidator } from './py-ruc';
import {
  DocumentType,
  DocumentValidationResult,
  DocumentValidator,
  CountryCode,
  UnsupportedDocumentTypeError,
} from './types';

export * from './types';
export { brCpfValidator, brCnpjValidator, pyCiValidator, pyRucValidator };

const REGISTRY: DocumentValidator[] = [
  brCpfValidator,
  brCnpjValidator,
  pyCiValidator,
  pyRucValidator,
];

function key(country: CountryCode, type: DocumentType): string {
  return `${country.toUpperCase()}:${type.toUpperCase()}`;
}

const INDEX = new Map<string, DocumentValidator>(
  REGISTRY.map((v) => [key(v.country, v.type), v]),
);

/**
 * Retorna a lista de validadores suportados (útil para UI/select).
 */
export function listSupportedDocuments(): Array<{ country: CountryCode; type: DocumentType }> {
  return REGISTRY.map((v) => ({ country: v.country, type: v.type }));
}

/**
 * Verifica se há validador registrado para o par (país, tipo).
 */
export function isDocumentTypeSupported(country: CountryCode, type: DocumentType): boolean {
  return INDEX.has(key(country, type));
}

/**
 * Valida um documento. Lança `UnsupportedDocumentTypeError` se o par
 * (país, tipo) não tem validador registrado — assim a aplicação não
 * "engole" documentos de países não cobertos.
 */
export function validateDocument(
  country: CountryCode,
  type: DocumentType,
  value: string,
): DocumentValidationResult {
  const validator = INDEX.get(key(country, type));
  if (!validator) throw new UnsupportedDocumentTypeError(country, type);
  return validator.validate(value);
}
