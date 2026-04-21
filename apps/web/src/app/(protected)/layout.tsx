'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { SWRConfig } from 'swr';

import { AppShell } from '@/components/layout/AppShell';
import { PageLoader } from '@/components/ui/Spinner';
import { swrFetcher } from '@/lib/api';
import { getSession, type Session } from '@/lib/session';

/**
 * Guard do grupo (protected): lê a sessão no client e redireciona para /login
 * se não houver token. Também provê o `SWRConfig` global com o fetcher do api.ts.
 */
export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const s = getSession();
    if (!s) {
      router.replace('/login');
      return;
    }
    setSession(s);
    setChecked(true);
  }, [router]);

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
      <AppShell session={session}>{children}</AppShell>
    </SWRConfig>
  );
}
