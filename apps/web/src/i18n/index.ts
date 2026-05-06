/**
 * Hub central de i18n no client.
 *
 * Por que rolar nossa própria infra mínima ao invés de só `next-intl`:
 *   - Não estamos usando i18n routing (`/[locale]/...`). O locale ativo vem do
 *     user/tenant carregados depois do login — fora da URL.
 *   - O `NextIntlClientProvider` aceita `messages` direto, então só precisamos
 *     resolver dictionary + locale no cliente.
 *
 * Adicionar novo idioma:
 *   1. Criar `messages/<locale>.ts` espelhando o shape de `pt-BR.ts`.
 *   2. Adicionar entrada em `MESSAGES`.
 *   3. Adicionar o código em `SUPPORTED_LOCALES` em `@netx/shared` (preset
 *      do país relevante).
 */

import ptBR from './messages/pt-BR';
import esPY from './messages/es-PY';
import enUS from './messages/en-US';

import type { Messages } from './messages/pt-BR';

export type AppLocale = 'pt-BR' | 'es-PY' | 'en-US';
export const APP_LOCALES: AppLocale[] = ['pt-BR', 'es-PY', 'en-US'];

const MESSAGES: Record<AppLocale, Messages> = {
  'pt-BR': ptBR,
  'es-PY': esPY as Messages,
  'en-US': enUS as Messages,
};

export const APP_LOCALE_LABEL: Record<AppLocale, string> = {
  'pt-BR': 'Português (Brasil)',
  'es-PY': 'Español (Paraguay)',
  'en-US': 'English (US)',
};

export function isAppLocale(s: string | null | undefined): s is AppLocale {
  return !!s && (APP_LOCALES as string[]).includes(s);
}

// Default global do app — Paraguai é o mercado primário. Quando user/tenant
// não definem locale, caímos em es-PY.
export const DEFAULT_APP_LOCALE: AppLocale = 'es-PY';

export function resolveAppLocale(s: string | null | undefined): AppLocale {
  return isAppLocale(s) ? s : DEFAULT_APP_LOCALE;
}

export function getMessages(locale: AppLocale): Messages {
  return MESSAGES[locale];
}
