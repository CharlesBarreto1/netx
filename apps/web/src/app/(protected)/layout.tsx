'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { SWRConfig } from 'swr';

import { AppShell } from '@/components/layout/AppShell';
import { PageLoader } from '@/components/ui/Spinner';
import { swrFetcher } from '@/lib/api';
import { I18nProvider } from '@/lib/i18n-provider';
import { getSession, type Session } from '@/lib/session';
import { TenantConfigProvider } from '@/lib/tenant-config';

/**
 * Guard do grupo (protected): lê a sessão no client e redireciona para /login
 * se não houver token. Provê:
 *   - SWRConfig global com `swrFetcher`
 *   - TenantConfigProvider (carrega /tenants/me + /users/me, expõe locale/currency/preset)
 *   - I18nProvider (NextIntlClientProvider com locale efetivo)
 *
 * Ordem importa: SWR → TenantConfig (usa SWR) → I18n (usa TenantConfig).
 */
export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
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
    // Senha temporária — bloqueia acesso a qualquer rota até trocar.
    // /first-login está fora do grupo (protected), então o usuário lá
    // continua autenticado (lê o token) mas não passa por aqui.
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

  return (
    <SWRConfig
      value={{
        fetcher: swrFetcher,
        revalidateOnFocus: true,
        dedupingInterval: 2000,
        shouldRetryOnError: (err) => {
          // Não repete em 4xx (erros do cliente), só em 5xx / network.
          const status = (err as { status?: number } | undefined)?.status;
          if (typeof status === 'number' && status >= 400 && status < 500) return false;
          return true;
        },
      }}
    >
      <TenantConfigProvider>
        <I18nProvider>
          <AppShell session={session}>{children}</AppShell>
        </I18nProvider>
      </TenantConfigProvider>
    </SWRConfig>
  );
}
