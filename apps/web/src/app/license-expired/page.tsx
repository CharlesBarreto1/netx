'use client';

/**
 * /license-expired — tela mostrada quando a API devolve 402 (licença desta
 * instalação bloqueada/expirada). Fica FORA do grupo (protected) de propósito:
 * o AppShell e os providers de tenant fazem chamadas que tomariam 402 e
 * causariam loop. Aqui só lemos GET /v1/license/status (rota isenta) e
 * mostramos a orientação pra regularizar.
 *
 * A sessão continua válida (402 não desloga) — o dono consegue ver esta tela e
 * disparar uma reverificação. A rede dos assinantes (RADIUS/PPPoE) não é
 * afetada por licença; só o painel de operador fica travado.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/Button';
import { ApiError } from '@/lib/api';
import { AuthI18nProvider } from '@/lib/auth-i18n-provider';
import { licenseApi, type LicenseStatusResponse } from '@/lib/license-api';
import { getSession, clearSession } from '@/lib/session';

export default function LicenseExpiredPage() {
  return (
    <AuthI18nProvider>
      <LicenseExpired />
    </AuthI18nProvider>
  );
}

function LicenseExpired() {
  const t = useTranslations('license');
  const router = useRouter();
  const [status, setStatus] = useState<LicenseStatusResponse | null>(null);
  const [checking, setChecking] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!getSession()) {
      router.replace('/login');
      return;
    }
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    try {
      const s = await licenseApi.status();
      setStatus(s);
      // Licença voltou a valer enquanto a tela estava aberta → volta pro app.
      if (s.effect === 'ALLOW' || s.effect === 'GRACE' || s.effect === 'DISABLED') {
        router.replace('/dashboard');
      }
    } catch {
      // status é isento de 402; se falhar é rede/sessão — ignora e mostra a tela.
    }
  }

  async function recheck() {
    setChecking(true);
    setMsg(null);
    try {
      const s = await licenseApi.refresh();
      setStatus(s);
      if (s.effect === 'ALLOW' || s.effect === 'GRACE' || s.effect === 'DISABLED') {
        router.replace('/dashboard');
        return;
      }
      setMsg(t('stillBlocked'));
    } catch (err) {
      // refresh exige permissão admin; sem ela, orienta a chamar quem tem.
      setMsg(err instanceof ApiError ? err.friendlyMessage : t('recheckFailed'));
    } finally {
      setChecking(false);
    }
  }

  function logout() {
    clearSession();
    router.replace('/login');
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6 dark:bg-slate-950">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-400">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 9v4" /><path d="M12 17h.01" />
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            {t('title')}
          </h1>
        </div>

        <p className="text-sm text-slate-600 dark:text-slate-300">{t('body')}</p>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{t('networkNote')}</p>

        {status && (
          <dl className="mt-5 grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-3 text-xs dark:bg-slate-800/60">
            <dt className="text-slate-500">{t('statusLabel')}</dt>
            <dd className="text-right font-medium">{status.status}</dd>
            {status.expiresAt && (
              <>
                <dt className="text-slate-500">{t('expiresAt')}</dt>
                <dd className="text-right font-medium">
                  {new Date(status.expiresAt).toLocaleString()}
                </dd>
              </>
            )}
            {status.lastHeartbeatAt && (
              <>
                <dt className="text-slate-500">{t('lastContact')}</dt>
                <dd className="text-right font-medium">
                  {new Date(status.lastHeartbeatAt).toLocaleString()}
                </dd>
              </>
            )}
          </dl>
        )}

        {msg && (
          <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
            {msg}
          </p>
        )}

        <div className="mt-6 flex items-center justify-between gap-3">
          <button
            onClick={logout}
            className="text-sm text-slate-500 hover:underline dark:text-slate-400"
          >
            {t('logout')}
          </button>
          <Button onClick={recheck} loading={checking}>
            {t('recheck')}
          </Button>
        </div>

        <p className="mt-6 border-t border-slate-100 pt-4 text-center text-xs text-slate-400 dark:border-slate-800">
          {t('contact')}
        </p>
      </div>
    </main>
  );
}
