'use client';

import { NextIntlClientProvider } from 'next-intl';

import { getMessages } from '@/i18n';
import { useTenantConfig } from './tenant-config';

/**
 * I18nProvider — conecta o `NextIntlClientProvider` aos valores efetivos do
 * usuário/tenant. Renderiza children sem provider enquanto `tenant`/`user`
 * carregam (NextIntlClientProvider exige `messages` definido).
 *
 * Estratégia: enquanto `isLoading`, mostramos um fallback. Isso garante que
 * todos os `useTranslations` sob a árvore tenham locale válido.
 */
export function I18nProvider({ children }: { children: React.ReactNode }) {
  const { effectiveLocale, tenant } = useTenantConfig();
  const messages = getMessages(effectiveLocale);

  return (
    <NextIntlClientProvider
      locale={effectiveLocale}
      messages={messages as Record<string, unknown>}
      timeZone={tenant?.timezone ?? 'America/Sao_Paulo'}
    >
      {children}
    </NextIntlClientProvider>
  );
}
