/**
 * /first-login — tela de troca obrigatória de senha.
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 * @provenance Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=
 *
 * Quando o backend devolve `user.mustChangePassword=true` no login, o
 * /login redireciona pra cá ANTES de qualquer rota protegida. Esta página
 * fica fora do grupo (protected) — não passa pelo guard que checa a flag,
 * só pelo check de "tem token".
 *
 * Após troca bem-sucedida, atualiza o snapshot da sessão em localStorage
 * (limpa a flag) e redireciona pra /dashboard.
 */
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { ApiError } from '@/lib/api';
import { authApi } from '@/lib/auth-api';
import { getSession } from '@/lib/session';

export default function FirstLoginPage() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [bootChecked, setBootChecked] = useState(false);

  // Não deixa ninguém visitar /first-login sem sessão ativa, ou que já trocou
  // a senha (e voltou na URL). Em ambos os casos manda pra rota apropriada.
  useEffect(() => {
    const s = getSession();
    if (!s) {
      router.replace('/login');
      return;
    }
    if (!s.user.mustChangePassword) {
      router.replace('/dashboard');
      return;
    }
    setBootChecked(true);
  }, [router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (newPassword !== confirmPassword) {
      setErr('As senhas não conferem.');
      return;
    }
    if (newPassword.length < 8) {
      setErr('A nova senha precisa ter pelo menos 8 caracteres.');
      return;
    }
    if (newPassword === currentPassword) {
      setErr('A nova senha não pode ser igual à atual.');
      return;
    }
    setLoading(true);
    try {
      await authApi.changePassword(currentPassword, newPassword);
      // Atualiza o snapshot de session em localStorage limpando a flag —
      // assim o ProtectedLayout deixa passar imediatamente sem precisar
      // re-autenticar. O backend já invalidou outras sessões.
      const raw = localStorage.getItem('netx.user');
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          parsed.mustChangePassword = false;
          localStorage.setItem('netx.user', JSON.stringify(parsed));
        } catch {
          /* se localStorage corrompeu, força novo login */
          localStorage.removeItem('netx.user');
          router.replace('/login');
          return;
        }
      }
      router.replace('/dashboard');
    } catch (e) {
      setErr(e instanceof ApiError ? e.friendlyMessage : (e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  if (!bootChecked) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900">
        <div className="text-sm text-slate-500">Verificando sessão…</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900 px-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-md rounded-xl shadow-xl bg-white dark:bg-slate-800 p-8 space-y-4"
      >
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-bold">Defina sua nova senha</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Por segurança, antes de continuar você precisa trocar a senha
            inicial pela sua.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Senha atual</label>
          <input
            type="password"
            autoComplete="current-password"
            className="w-full px-3 py-2 rounded-md border border-slate-300 dark:border-slate-600 bg-transparent"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
            autoFocus
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Nova senha</label>
          <input
            type="password"
            autoComplete="new-password"
            className="w-full px-3 py-2 rounded-md border border-slate-300 dark:border-slate-600 bg-transparent"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            minLength={8}
            required
          />
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Mínimo 8 caracteres com letra maiúscula, minúscula, número e
            símbolo.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">
            Confirmar nova senha
          </label>
          <input
            type="password"
            autoComplete="new-password"
            className="w-full px-3 py-2 rounded-md border border-slate-300 dark:border-slate-600 bg-transparent"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            minLength={8}
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
          {loading ? 'Salvando…' : 'Definir nova senha e entrar'}
        </button>

        <p className="text-[11px] text-center text-slate-400 pt-2">
          © 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA
        </p>
      </form>
    </main>
  );
}
