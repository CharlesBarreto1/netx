'use client';

import { Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { use, useEffect, useState } from 'react';

import { NetxLogo } from '@/components/brand/NetxLogo';
import { AuthI18nProvider } from '@/lib/auth-i18n-provider';
import {
  abortInteraction,
  fetchInteractionDetails,
  OidcInteractionError,
  submitInteractionLogin,
  type InteractionDetails,
} from '@/lib/oidc-api';

/**
 * Tela de autenticação do fluxo OIDC.
 *
 * Separada do /login de propósito: aqui a pessoa não está entrando no NetX, e
 * sim autorizando um aplicativo externo (hoje o Nextcloud) a saber quem ela é.
 * Ela precisa VER para qual aplicação está entrando — enfiar isso na tela de
 * login interna esconderia essa informação e tornaria um phishing mais fácil
 * de disfarçar.
 *
 * É pré-login (sem tenant resolvido), então o i18n vem do AuthI18nProvider.
 *
 * Não redireciona sozinha: o backend devolve `returnTo` e só então navegamos.
 * Assim senha errada não custa a navegação e o fluxo não se perde.
 */
export default function OidcInteractionPage({
  params,
}: {
  params: Promise<{ slug: string; uid: string }>;
}) {
  const { slug, uid } = use(params);
  return (
    <AuthI18nProvider>
      <InteractionForm slug={slug} uid={uid} />
    </AuthI18nProvider>
  );
}

function InteractionForm({ slug, uid }: { slug: string; uid: string }) {
  const t = useTranslations('oidc');

  const [details, setDetails] = useState<InteractionDetails | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaToken, setMfaToken] = useState('');
  const [needsMfa, setNeedsMfa] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelado = false;
    fetchInteractionDetails(slug, uid)
      .then((d) => {
        if (!cancelado) setDetails(d);
      })
      .catch(() => {
        if (!cancelado) setLoadError(t('expired'));
      });
    return () => {
      cancelado = true;
    };
  }, [slug, uid, t]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { returnTo } = await submitInteractionLogin(slug, uid, {
        email,
        password,
        mfaToken: needsMfa ? mfaToken.trim() : undefined,
      });
      window.location.href = returnTo;
    } catch (err) {
      if (err instanceof OidcInteractionError) {
        if (err.reason === 'mfa_required') {
          // Primeiro fator aceito. Não é erro — é o segundo passo.
          setNeedsMfa(true);
          setError(null);
        } else if (err.reason === 'mfa_invalid') {
          setNeedsMfa(true);
          setError(t('mfaInvalid'));
        } else {
          setError(t('invalidCredentials'));
        }
      } else {
        setError(t('genericError'));
      }
      setBusy(false);
    }
  }

  async function onCancel() {
    setBusy(true);
    try {
      const { returnTo } = await abortInteraction(slug, uid);
      window.location.href = returnTo;
    } catch {
      setError(t('genericError'));
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg px-4">
        <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 text-center shadow-xl dark:border-slate-700 dark:bg-slate-800">
          <h1 className="text-lg font-semibold">{t('expiredTitle')}</h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{loadError}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <NetxLogo className="h-8" />
        </div>

        <form
          onSubmit={onSubmit}
          className="space-y-5 rounded-xl border border-slate-200 bg-white p-8 shadow-xl dark:border-slate-700 dark:bg-slate-800"
        >
          <header className="space-y-2 text-center">
            <ShieldCheck className="mx-auto h-8 w-8 text-emerald-600 dark:text-emerald-400" />
            <h1 className="text-xl font-bold">{t('title')}</h1>
            {/* Dizer QUAL aplicação está pedindo acesso é o ponto desta tela. */}
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {details
                ? t('subtitle', {
                    app: details.clientName ?? details.clientId,
                    tenant: details.tenantName,
                  })
                : t('loading')}
            </p>
          </header>

          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-medium">
              {t('emailLabel')}
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="username"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy || !details}
              className="w-full rounded-md border border-slate-300 bg-transparent px-3 py-2 disabled:opacity-50 dark:border-slate-600"
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-medium">
              {t('passwordLabel')}
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy || !details}
                className="w-full rounded-md border border-slate-300 bg-transparent px-3 py-2 pr-10 disabled:opacity-50 dark:border-slate-600"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? t('hidePassword') : t('showPassword')}
                className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {needsMfa && (
            <div>
              <label htmlFor="mfa" className="mb-1 block text-sm font-medium">
                {t('mfaLabel')}
              </label>
              <input
                id="mfa"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                value={mfaToken}
                onChange={(e) => setMfaToken(e.target.value)}
                disabled={busy}
                className="w-full rounded-md border border-slate-300 bg-transparent px-3 py-2 tracking-widest disabled:opacity-50 dark:border-slate-600"
              />
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t('mfaHint')}</p>
            </div>
          )}

          {error && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          )}

          <div className="space-y-2">
            <button
              type="submit"
              disabled={busy || !details}
              className="w-full rounded-md bg-slate-900 px-4 py-2 font-medium text-white disabled:opacity-50 dark:bg-white dark:text-slate-900"
            >
              {busy ? t('submitting') : t('submit')}
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="w-full rounded-md px-4 py-2 text-sm text-slate-500 hover:text-slate-800 disabled:opacity-50 dark:hover:text-slate-200"
            >
              {t('cancel')}
            </button>
          </div>

          {details && details.scopes.length > 0 && (
            <p className="border-t border-slate-200 pt-4 text-center text-xs text-slate-400 dark:border-slate-700">
              {t('scopesNotice')}
            </p>
          )}
        </form>
      </div>
    </main>
  );
}
