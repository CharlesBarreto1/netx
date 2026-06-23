'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { portalApi, portalToken, HubApiError } from '@/lib/api';
import { inputCls } from '@/components/ui';

export default function PortalLogin() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      const { token } = await portalApi.login(email, password);
      portalToken.set(token);
      router.replace('/portal');
    } catch (e2) {
      setErr(e2 instanceof HubApiError ? 'E-mail ou senha inválidos.' : 'Falha ao conectar.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 px-6">
      <div>
        <h1 className="text-xl font-bold">Central do cliente</h1>
        <p className="text-sm text-slate-500">Acesse para ver faturas e regularizar.</p>
      </div>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <input type="email" placeholder="E-mail" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} autoFocus />
        <input type="password" placeholder="Senha" value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} />
        {err && <p className="text-sm text-red-600">{err}</p>}
        <button disabled={loading || !email || !password} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {loading ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </main>
  );
}
