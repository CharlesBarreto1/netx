'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { apiLogin } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('admin@netx.local');
  const [password, setPassword] = useState('');
  const [tenantSlug, setTenantSlug] = useState('default');
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      const res = await apiLogin({ email, password, tenantSlug });
      // localStorage compartilha entre abas — necessário pra abas de print
      // (/service-orders/[id]/print, /invoices/[id]/print) abrirem com sessão.
      localStorage.setItem('netx.accessToken', res.accessToken);
      localStorage.setItem('netx.refreshToken', res.refreshToken);
      localStorage.setItem('netx.user', JSON.stringify(res.user));
      localStorage.setItem('netx.tenant', JSON.stringify(res.tenant));
      router.push('/dashboard');
    } catch (e: any) {
      setErr(e?.message ?? 'Falha ao autenticar');
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
          />
        </div>

        {err && (
          <div className="text-sm text-red-600 bg-red-50 dark:bg-red-950/40 rounded-md px-3 py-2">
            {err}
          </div>
        )}

        <button
          disabled={loading}
          className="w-full py-2.5 rounded-md bg-brand-600 text-white font-semibold hover:bg-brand-700 disabled:opacity-60"
        >
          {loading ? 'Autenticando…' : 'Entrar'}
        </button>

        <p className="text-xs text-center text-slate-500 dark:text-slate-400 pt-2">
          Login de desenvolvimento: <code className="font-mono">admin@netx.local / ChangeMe!2026</code>
        </p>
      </form>
    </main>
  );
}
