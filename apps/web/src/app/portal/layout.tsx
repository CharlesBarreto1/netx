/**
 * Layout do Portal do Cliente.
 *
 * Isolado do operador: sem AppShell, sem TenantConfigProvider. Agora fornece
 * i18n multi-locale (pt-BR / es-PY / en-US) via AuthI18nProvider — mesmo
 * provider das telas pré-login (/login), que resolve o locale pelo idioma do
 * navegador. Assim todas as páginas do portal recebem o NextIntlClientProvider.
 */
import type { Metadata } from 'next';

import { AuthI18nProvider } from '@/lib/auth-i18n-provider';

export const metadata: Metadata = {
  title: 'Portal — NetX',
};

// Portal é 100% client-side (auth via localStorage). Forçar dynamic evita
// que o Next tente pré-renderizar e bater no NextIntl global do (protected).
export const dynamic = 'force-dynamic';

export default function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthI18nProvider>
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900">{children}</div>
    </AuthI18nProvider>
  );
}
