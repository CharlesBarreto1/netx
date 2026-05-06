/**
 * Layout do Portal do Cliente.
 *
 * Isolado do operador: sem AppShell, sem TenantConfigProvider (que assume
 * sessão do operador). Header simples com o nome da operação + sair.
 *
 * Idioma fixo no es-PY no MVP — quando virar multi-país, lemos do customer
 * e injetamos NextIntlClientProvider igual /(protected)/layout.tsx.
 */
import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';

import esPY from '@/i18n/messages/es-PY';

export const metadata: Metadata = {
  title: 'Portal — NetX',
};

export default function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <NextIntlClientProvider locale="es-PY" messages={esPY as never}>
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
        {children}
      </div>
    </NextIntlClientProvider>
  );
}
