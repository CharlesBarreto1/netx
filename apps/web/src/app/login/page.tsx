'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { ApiError, apiLogin } from '@/lib/api';
import { AuthI18nProvider } from '@/lib/auth-i18n-provider';

/**
 * Tela de login. Quando o user tem 2FA ativo, o backend devolve 401 com
 * `type: 'urn:netx:error:mfa-required'` e mostramos o campo de token TOTP.
 * Próxima tentativa de submit reenvia email/senha + mfaToken.
 *
 * É pré-login (sem tenant), então o i18n vem do `AuthI18nProvider` (idioma do
 * navegador → es-PY default), não do `I18nProvider` baseado em tenant.
 */
export default function LoginPage() {
  return (
    <AuthI18nProvider>
      <LoginForm />
    </AuthI18nProvider>
  );
}

function LoginForm() {
  const t = useTranslations('auth.login');
  const router = useRouter();
  const [email, setEmail] = useState('admin@netx.local');
  const [password, setPassword] = useState('');
  // Vazio por padrão — o backend cai no DEFAULT_TENANT_SLUG do .env quando
  // tenantSlug não é enviado. Cada instância NetX = um ISP = um tenant.
  const [tenantSlug, setTenantSlug] = useState('');
  const [mfaToken, setMfaToken] = useState('');
  const [needsMfa, setNeedsMfa] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      const res = await apiLogin({
        email,
        password,
        // Só envia tenantSlug se o user digitou explicitamente — assim o
        // backend usa o DEFAULT_TENANT_SLUG do .env, evitando descasamento
        // entre o slug literal "default" e o slug real do tenant criado
        // pelo installer.
        ...(tenantSlug.trim() ? { tenantSlug: tenantSlug.trim() } : {}),
        ...(needsMfa && mfaToken ? { mfaToken } : {}),
      });
      localStorage.setItem('netx.accessToken', res.accessToken);
      localStorage.setItem('netx.refreshToken', res.refreshToken);
      localStorage.setItem('netx.user', JSON.stringify(res.user));
      localStorage.setItem('netx.tenant', JSON.stringify(res.tenant));
      // Senha temporária (admin recém-seedado, reset por outro admin) →
      // empurra direto pra tela de troca obrigatória. ProtectedLayout faz
      // de novo se o user tentar acessar qualquer rota antes de trocar.
      if (res.user.mustChangePassword) {
        router.replace('/first-login');
        return;
      }
      router.push('/dashboard');
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.problem.type === 'urn:netx:error:mfa-required') {
          // Primeiro 401 com MFA — esconde os erros de senha e mostra campo.
          setNeedsMfa(true);
          setErr(null);
          setLoading(false);
          return;
        }
        if (e.problem.type === 'urn:netx:error:mfa-invalid') {
          setErr(t('mfaInvalid'));
          setLoading(false);
          return;
        }
        setErr(e.friendlyMessage);
      } else {
        setErr((e as Error)?.message ?? t('failed'));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900 px-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-md rounded-xl shadow-xl bg-white dark:bg-slate-800 p-8 space-y-4"
      >
        <h1 className="text-2xl font-bold text-center mb-2">{t('title')}</h1>

        {/*
          Tenant é detalhe interno — cada instância NetX serve um único ISP,
          e o backend resolve via DEFAULT_TENANT_SLUG do .env. Não exposto na
          UI. Se precisar debug multi-tenant no futuro, edita o setState
          inicial ou usa searchParams.
        */}

        <div>
          <label className="block text-sm font-medium mb-1">{t('email')}</label>
          <input
            type="email"
            className="w-full px-3 py-2 rounded-md border border-slate-300 dark:border-slate-600 bg-transparent"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={needsMfa}
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">
            {t('password')}
          </label>
          <input
            type="password"
            className="w-full px-3 py-2 rounded-md border border-slate-300 dark:border-slate-600 bg-transparent"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={needsMfa}
          />
        </div>

        {needsMfa && (
          <div>
            <label className="block text-sm font-medium mb-1">
              {t('mfaLabel')}
            </label>
            <input
              inputMode="numeric"
              autoFocus
              maxLength={8}
              className="w-full px-3 py-2 rounded-md border border-slate-300 dark:border-slate-600 bg-transparent font-mono tracking-widest"
              value={mfaToken}
              onChange={(e) => setMfaToken(e.target.value.replace(/[\s-]/gu, ''))}
              placeholder="000000"
              required
            />
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {t('mfaHelp')}
            </p>
          </div>
        )}

        {err && (
          <div className="text-sm text-red-600 bg-red-50 dark:bg-red-950/40 rounded-md px-3 py-2">
            {err}
          </div>
        )}

        <button
          disabled={loading || (needsMfa && mfaToken.length < 6)}
          className="w-full py-2.5 rounded-md bg-brand-600 text-white font-semibold hover:bg-brand-700 disabled:opacity-60"
        >
          {loading
            ? t('submitting')
            : needsMfa
              ? t('confirmCode')
              : t('submit')}
        </button>

        {needsMfa && (
          <button
            type="button"
            onClick={() => {
              setNeedsMfa(false);
              setMfaToken('');
              setErr(null);
            }}
            className="w-full text-xs text-slate-500 hover:underline dark:text-slate-400"
          >
            {t('back')}
          </button>
        )}
      </form>
    </main>
  );
}
