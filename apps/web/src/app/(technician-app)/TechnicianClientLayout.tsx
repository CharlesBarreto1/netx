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
import { useTranslations } from 'next-intl';
import { SWRConfig } from 'swr';

import { PageLoader } from '@/components/ui/Spinner';
import { AuthI18nProvider } from '@/lib/auth-i18n-provider';
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
    return (
      <AuthI18nProvider>
        <CheckingSession />
      </AuthI18nProvider>
    );
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
          <FieldChrome
            userName={displayName(session.user)}
            canField={canField}
            onLogout={logout}
          >
            {children}
          </FieldChrome>
        </I18nProvider>
      </TenantConfigProvider>
    </SWRConfig>
  );
}

/** Loader do gate de sessão — traduzido via provider pré-login. */
function CheckingSession() {
  const t = useTranslations('technician');
  return <PageLoader label={t('checkingSession')} />;
}

/**
 * Chrome (header + container) da área de campo. Componente separado porque
 * precisa consumir o `I18nProvider` renderizado pelo pai — `useTranslations`
 * só enxerga o provider se for chamado num descendente.
 */
function FieldChrome({
  userName,
  canField,
  onLogout,
  children,
}: {
  userName: string;
  canField: boolean;
  onLogout: () => void;
  children: React.ReactNode;
}) {
  const t = useTranslations('technician');
  return (
    <div className="min-h-screen bg-bg text-text">
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-surface/80 px-4 backdrop-blur">
        <div className="flex items-center gap-2 font-bold tracking-tight">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-accent text-accent-foreground shadow-sm">
            N
          </span>
          <span>
            NetX{' '}
            <span className="text-sm font-normal text-text-subtle">
              {t('appSubtitle')}
            </span>
          </span>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="hidden text-text-muted sm:inline">{userName}</span>
          <button
            type="button"
            onClick={onLogout}
            className="rounded-md px-2 py-1 text-danger hover:bg-danger-muted"
          >
            {t('logout')}
          </button>
        </div>
      </header>
      <main className="mx-auto w-full max-w-xl px-4 py-4">
        {canField ? (
          children
        ) : (
          <div className="rounded-md border border-border bg-surface p-4 text-sm text-text-muted">
            {t.rich('noFieldPermission', {
              c: (chunks) => <code className="font-mono">{chunks}</code>,
            })}
          </div>
        )}
      </main>
    </div>
  );
}
