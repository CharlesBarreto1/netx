'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { ApiError, apiLogin } from '@/lib/api';

/**
 * Tela de login. Quando o user tem 2FA ativo, o backend devolve 401 com
 * `type: 'urn:netx:error:mfa-required'` e mostramos o campo de token TOTP.
 * Próxima tentativa de submit reenvia email/senha + mfaToken.
 */
export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('admin@netx.local');
  const [password, setPassword] = useState('');
  const [tenantSlug, setTenantSlug] = useState('default');
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
        tenantSlug,
        ...(needsMfa && mfaToken ? { mfaToken } : {}),
      });
      localStorage.setItem('netx.accessToken', res.accessToken);
      localStorage.setItem('netx.refreshToken', res.refreshToken);
      localStorage.setItem('netx.user', JSON.stringify(res.user));
      localStorage.setItem('netx.tenant', JSON.stringify(res.tenant));
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
          setErr('Código MFA inválido. Tente de novo.');
          setLoading(false);
          return;
        }
        setErr(e.friendlyMessage);
      } else {
        setErr((e as Error)?.message ?? 'Falha ao autenticar');
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
        <h1 className="text-2xl font-bold text-center mb-2">Entrar no NetX</h1>

        <div>
          <label className="block text-sm font-medium mb-1">Tenant</label>
          <input
            className="w-full px-3 py-2 rounded-md border border-slate-300 dark:border-slate-600 bg-transparent"
            value={tenantSlug}
            onChange={(e) => setTenantSlug(e.target.value)}
            required
            disabled={needsMfa}
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Email</label>
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
          <label className="block text-sm font-medium mb-1">Senha</label>
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
              Código do app autenticador
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
              6 dígitos do app (Google Authenticator/Authy) ou 8 caracteres de
              um backup code.
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
          {loading ? 'Autenticando…' : needsMfa ? 'Confirmar código' : 'Entrar'}
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
            ← voltar
          </button>
        )}
      </form>
    </main>
  );
}
