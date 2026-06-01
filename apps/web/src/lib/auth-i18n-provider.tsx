'use client';

import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl';
import { useEffect, useState } from 'react';

import { DEFAULT_APP_LOCALE, getMessages, type AppLocale } from '@/i18n';

/**
 * AuthI18nProvider — i18n para telas PRÉ-login (/login, /first-login), onde
 * ainda não há tenant/user e, portanto, não dá pra usar o `I18nProvider`
 * baseado em `useTenantConfig`.
 *
 * Resolução de locale: idioma do navegador → pt-BR / es-PY / en-US; senão cai
 * no `DEFAULT_APP_LOCALE` (es-PY, mercado primário). O SSR e o primeiro render
 * no cliente usam o default (evita mismatch de hidratação); o efeito ajusta
 * pro idioma do navegador logo após montar.
 */
function detectBrowserLocale(): AppLocale {
  if (typeof navigator === 'undefined') return DEFAULT_APP_LOCALE;
  const candidates = [navigator.language, ...(navigator.languages ?? [])];
  for (const raw of candidates) {
    const lang = (raw ?? '').toLowerCase();
    if (lang.startsWith('pt')) return 'pt-BR';
    if (lang.startsWith('es')) return 'es-PY';
    if (lang.startsWith('en')) return 'en-US';
  }
  return DEFAULT_APP_LOCALE;
}

export function AuthI18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocale] = useState<AppLocale>(DEFAULT_APP_LOCALE);
  useEffect(() => {
    setLocale(detectBrowserLocale());
  }, []);

  const messages = getMessages(locale);

  return (
    <NextIntlClientProvider
      locale={locale}
      messages={messages as unknown as AbstractIntlMessages}
      timeZone="America/Asuncion"
    >
      {children}
    </NextIntlClientProvider>
  );
}
