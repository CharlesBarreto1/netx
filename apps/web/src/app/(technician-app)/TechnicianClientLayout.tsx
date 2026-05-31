'use client';

/**
 * TechnicianClientLayout — providers + guard pra tela de campo (/os), SEM
 * AppShell. Mobile-first: header enxuto, container estreito (max-w-xl).
 *
 * Gate: só técnico com `service_orders.write` (lifecycle da O.S) — o one-touch
 * de instalação ainda exige `provisioning.write` no backend.
 */
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { SWRConfig } from 'swr';

import { PageLoader } from '@/components/ui/Spinner';
import { authApi } from '@/lib/auth-api';
import { swrFetcher } from '@/lib/api';
import { I18nProvider } from '@/lib/i18n-provider';
import {
  clearSession,
  displayName,
  getSession,
  hasAnyPermission,
  type Session,
} from '@/lib/session';
import { TenantConfigProvider } from '@/lib/tenant-config';

export default function TechnicianClientLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [session, setSession] = useState<Session | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const s = getSession();
    if (!s) {
      router.replace('/login');
      return;
    }
    if (s.user.mustChangePassword && pathname !== '/first-login') {
      router.replace('/first-login');
      return;
    }
    setSession(s);
    setChecked(true);
  }, [router, pathname]);

  if (!checked || !session) {
    return <PageLoader label="Verificando sessão…" />;
  }

  const canField = hasAnyPermission([
    'service_orders.write',
    'provisioning.write',
  ]);

  async function logout() {
    await authApi.logout();
    clearSession();
    router.replace('/login');
  }

  return (
    <SWRConfig
      value={{
        fetcher: swrFetcher,
        revalidateOnFocus: true,
        dedupingInterval: 2000,
        shouldRetryOnError: (err) => {
          const status = (err as { status?: number } | undefined)?.status;
          if (typeof status === 'number' && status >= 400 && status < 500)
            return false;
          return true;
        },
      }}
    >
      <TenantConfigProvider>
        <I18nProvider>
          <div className="min-h-screen bg-bg text-text">
            <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-surface/80 px-4 backdrop-blur">
              <div className="flex items-center gap-2 font-bold tracking-tight">
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-accent text-accent-foreground shadow-sm">
                  N
                </span>
                <span>
                  NetX{' '}
                  <span className="text-sm font-normal text-text-subtle">
                    Campo
                  </span>
                </span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <span className="hidden text-text-muted sm:inline">
                  {displayName(session.user)}
                </span>
                <button
                  type="button"
                  onClick={logout}
                  className="rounded-md px-2 py-1 text-danger hover:bg-danger-muted"
                >
                  Sair
                </button>
              </div>
            </header>
            <main className="mx-auto w-full max-w-xl px-4 py-4">
              {canField ? (
                children
              ) : (
                <div className="rounded-md border border-border bg-surface p-4 text-sm text-text-muted">
                  Você não tem permissão de campo. Peça ao admin os acessos{' '}
                  <code className="font-mono">service_orders.write</code> e{' '}
                  <code className="font-mono">provisioning.write</code>.
                </div>
              )}
            </main>
          </div>
        </I18nProvider>
      </TenantConfigProvider>
    </SWRConfig>
  );
}
