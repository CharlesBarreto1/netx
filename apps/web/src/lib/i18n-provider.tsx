'use client';

import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl';

import { getMessages } from '@/i18n';
import { useTenantConfig } from './tenant-config';

/**
 * I18nProvider — conecta o `NextIntlClientProvider` aos valores efetivos do
 * usuário/tenant.
 *
 * Sobre o cast em `messages`:
 *   `next-intl` exige `AbstractIntlMessages`, que é um tipo recursivo
 *   `{ [k: string]: string | AbstractIntlMessages }`. O nosso `Messages` é
 *   estruturalmente compatível (objeto de strings aninhadas), mas o TS não
 *   consegue inferir isso pelo `typeof` literal — daí o cast via `unknown`.
 */
export function I18nProvider({ children }: { children: React.ReactNode }) {
  const { effectiveLocale, tenant } = useTenantConfig();
  const messages = getMessages(effectiveLocale);

  return (
    <NextIntlClientProvider
      locale={effectiveLocale}
      messages={messages as unknown as AbstractIntlMessages}
      timeZone={tenant?.timezone ?? 'America/Sao_Paulo'}
    >
      {children}
    </NextIntlClientProvider>
  );
}
