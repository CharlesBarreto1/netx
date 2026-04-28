/**
 * Country presets — fonte única de verdade para parametrização por país.
 *
 * Cada operação NetX é vinculada a um país (campo `Tenant.country`, ISO 3166-1
 * alpha-2). A partir desse país, derivamos:
 *
 *   - `locale` default da operação (pode ser sobrescrito por `User.locale`)
 *   - `currency` (ISO 4217)
 *   - `timezone` (IANA)
 *   - `taxIdTypes` que fazem sentido pra esse país, com defaults por tipo de
 *     cliente (PF/PJ)
 *   - `supportedLocales` (idiomas que o usuário pode escolher dentro daquele
 *     tenant — ex.: tenant PY pode ter `es-PY` default e oferecer `pt-BR` pra
 *     equipe brasileira)
 *
 * Por que centralizar:
 *   - A regulação fiscal não cruza fronteiras: cada tenant é uma operação
 *     legalmente independente. Ter o país no core garante que módulos
 *     downstream (financeiro, fiscal, faturas) sempre escolham as regras certas.
 *   - O frontend usa o preset pra montar selects, formatadores e validações
 *     sem precisar de "if country === BR" espalhados pelo código.
 *
 * Como adicionar um novo país:
 *   1. Adicionar o código ISO ao `SUPPORTED_COUNTRIES` (ordem afeta UI).
 *   2. Adicionar entrada em `COUNTRY_PRESETS` com todos os campos.
 *   3. Se for um locale novo, ajustar `SUPPORTED_LOCALES` no app web.
 */

import type { DocumentType } from '../validators/documents/types';

export type CustomerKindForDoc = 'INDIVIDUAL' | 'COMPANY';

export interface CountryPreset {
  /** Código ISO 3166-1 alpha-2 — chave da tabela. */
  code: string;
  /** Nome do país no idioma default da operação. */
  name: string;
  /** Locale BCP 47 default da operação (ex.: 'es-PY'). */
  locale: string;
  /** Idiomas que o usuário pode escolher operando neste tenant. */
  supportedLocales: string[];
  /** ISO 4217 — código da moeda (ex.: 'PYG'). */
  currency: string;
  /** Símbolo opcional pra UI compacta (₲, R$, $). */
  currencySymbol?: string;
  /** Casas decimais — Guarani não tem centavos, então é 0. */
  currencyDecimals: number;
  /** Timezone IANA padrão (ex.: 'America/Asuncion'). */
  timezone: string;
  /** Tipos de documento aceitos por este país. */
  taxIdTypes: DocumentType[];
  /** Default de tipo de documento por tipo de cliente. */
  defaultTaxIdType: Record<CustomerKindForDoc, DocumentType>;
  /** ISO do país preferido pra preencher `Customer.taxIdCountry` (geralmente == code). */
  defaultTaxIdCountry: string;
  /**
   * DDI default para máscaras de telefone (ex.: '+55', '+595'). Não é usado
   * pra validar — só pra placeholder.
   */
  phoneDdi: string;
  /** Exemplo de telefone formatado pra usar como placeholder. */
  phonePlaceholder: string;
}

// =============================================================================
// PRESETS
// =============================================================================

export const COUNTRY_PRESETS: Record<string, CountryPreset> = {
  BR: {
    code: 'BR',
    name: 'Brasil',
    locale: 'pt-BR',
    supportedLocales: ['pt-BR', 'es-PY', 'en-US'],
    currency: 'BRL',
    currencySymbol: 'R$',
    currencyDecimals: 2,
    timezone: 'America/Sao_Paulo',
    taxIdTypes: ['CPF', 'CNPJ'],
    defaultTaxIdType: { INDIVIDUAL: 'CPF', COMPANY: 'CNPJ' },
    defaultTaxIdCountry: 'BR',
    phoneDdi: '+55',
    phonePlaceholder: '+55 11 99999-8888',
  },
  PY: {
    code: 'PY',
    name: 'Paraguay',
    locale: 'es-PY',
    supportedLocales: ['es-PY', 'pt-BR', 'en-US'],
    currency: 'PYG',
    currencySymbol: '₲',
    currencyDecimals: 0, // Guarani não tem centavos
    timezone: 'America/Asuncion',
    taxIdTypes: ['CI', 'RUC'],
    defaultTaxIdType: { INDIVIDUAL: 'CI', COMPANY: 'RUC' },
    defaultTaxIdCountry: 'PY',
    phoneDdi: '+595',
    phonePlaceholder: '+595 981 123-456',
  },
  // Stubs prontos pra ativar quando começar a operação. Os defaults podem
  // ser ajustados; o que importa é que cada novo país já tem entrada na
  // tabela e o frontend pode lidar sem código novo.
  AR: {
    code: 'AR',
    name: 'Argentina',
    locale: 'es-AR',
    supportedLocales: ['es-AR', 'es-PY', 'pt-BR', 'en-US'],
    currency: 'ARS',
    currencySymbol: '$',
    currencyDecimals: 2,
    timezone: 'America/Argentina/Buenos_Aires',
    taxIdTypes: ['CUIT'],
    defaultTaxIdType: { INDIVIDUAL: 'CUIT', COMPANY: 'CUIT' },
    defaultTaxIdCountry: 'AR',
    phoneDdi: '+54',
    phonePlaceholder: '+54 11 5555-5555',
  },
  CO: {
    code: 'CO',
    name: 'Colombia',
    locale: 'es-CO',
    supportedLocales: ['es-CO', 'es-PY', 'pt-BR', 'en-US'],
    currency: 'COP',
    currencySymbol: '$',
    currencyDecimals: 2,
    timezone: 'America/Bogota',
    taxIdTypes: ['NIT'],
    defaultTaxIdType: { INDIVIDUAL: 'NIT', COMPANY: 'NIT' },
    defaultTaxIdCountry: 'CO',
    phoneDdi: '+57',
    phonePlaceholder: '+57 300 000-0000',
  },
  MX: {
    code: 'MX',
    name: 'México',
    locale: 'es-MX',
    supportedLocales: ['es-MX', 'es-PY', 'pt-BR', 'en-US'],
    currency: 'MXN',
    currencySymbol: '$',
    currencyDecimals: 2,
    timezone: 'America/Mexico_City',
    taxIdTypes: ['RFC'],
    defaultTaxIdType: { INDIVIDUAL: 'RFC', COMPANY: 'RFC' },
    defaultTaxIdCountry: 'MX',
    phoneDdi: '+52',
    phonePlaceholder: '+52 55 0000-0000',
  },
  ES: {
    code: 'ES',
    name: 'España',
    locale: 'es-ES',
    supportedLocales: ['es-ES', 'pt-BR', 'en-US'],
    currency: 'EUR',
    currencySymbol: '€',
    currencyDecimals: 2,
    timezone: 'Europe/Madrid',
    taxIdTypes: ['NIF', 'VAT'],
    defaultTaxIdType: { INDIVIDUAL: 'NIF', COMPANY: 'VAT' },
    defaultTaxIdCountry: 'ES',
    phoneDdi: '+34',
    phonePlaceholder: '+34 600 000 000',
  },
};

/**
 * Ordem que aparece nos selects de "país da operação". O default global é
 * o primeiro item. Hoje BR primeiro porque é onde temos volume; quando
 * uma operação PY virar dominante, basta reordenar.
 */
export const SUPPORTED_COUNTRIES: string[] = ['BR', 'PY', 'AR', 'CO', 'MX', 'ES'];

/**
 * Locales reconhecidos pela aplicação. O frontend só carrega dictionaries
 * para os locales aqui listados — adicionar um locale novo exige criar o
 * arquivo de mensagens correspondente em `apps/web/src/i18n/messages/`.
 */
export const SUPPORTED_LOCALES = ['pt-BR', 'es-PY', 'en-US'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export function isSupportedLocale(s: string): s is SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(s);
}

/**
 * Retorna o preset de um país. Se o país não estiver na tabela, devolve o
 * preset BR como fallback seguro (evita crashar UI por país desconhecido).
 */
export function getCountryPreset(code: string | null | undefined): CountryPreset {
  if (!code) return COUNTRY_PRESETS.BR;
  return COUNTRY_PRESETS[code.toUpperCase()] ?? COUNTRY_PRESETS.BR;
}

/**
 * Resolve o locale efetivo: preferência do user > locale do tenant > preset
 * default do país do tenant > 'pt-BR'.
 */
export function resolveEffectiveLocale(input: {
  userLocale?: string | null;
  tenantLocale?: string | null;
  tenantCountry?: string | null;
}): string {
  const candidates = [
    input.userLocale,
    input.tenantLocale,
    input.tenantCountry ? getCountryPreset(input.tenantCountry).locale : null,
    'pt-BR',
  ].filter((x): x is string => Boolean(x && isSupportedLocale(x)));
  return candidates[0] ?? 'pt-BR';
}
