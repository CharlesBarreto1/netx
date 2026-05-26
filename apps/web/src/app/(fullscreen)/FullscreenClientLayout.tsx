'use client';

/**
 * FullscreenClientLayout — providers do app SEM AppShell.
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Replica session guard + providers do ProtectedClientLayout mas omite o
 * AppShell (header/sidebar globais). Páginas dentro de (fullscreen)
 * desenham UI inteira do zero — útil pro estúdio de mapeamento que
 * precisa de 100vh sem distração.
 *
 * Mantém tenant/i18n/SWR pra que páginas reusem hooks normais do app.
 */
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { SWRConfig } from 'swr';

import { PageLoader } from '@/components/ui/Spinner';
import { swrFetcher } from '@/lib/api';
import { I18nProvider } from '@/lib/i18n-provider';
import { getSession, type Session } from '@/lib/session';
import { TenantConfigProvider } from '@/lib/tenant-config';

export default function FullscreenClientLayout({
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
        <I18nProvider>{children}</I18nProvider>
      </TenantConfigProvider>
    </SWRConfig>
  );
}
