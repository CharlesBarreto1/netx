/**
 * Layout do Portal do Cliente.
 *
 * Isolado do operador: sem AppShell, sem TenantConfigProvider, sem
 * NextIntlClientProvider — strings ficam em es-PY direto no JSX porque o
 * portal é mono-locale no MVP. Multi-locale entra na Phase 2 quando o
 * customer.preferredLanguage virar select.
 */
import type { Metadata } from 'next';

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
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">{children}</div>
  );
}
