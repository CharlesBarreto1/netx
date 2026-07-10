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
 * UX:
 *  - Toggle "olho" pra revelar/esconder cada campo (evita typo silencioso
 *    em type=password)
 *  - Validação visual em tempo real dos 4 requisitos de senha forte
 *  - Feedback "✓ As senhas conferem" verde quando match
 *  - Mensagens de erro específicas (não genérica)
 *
 * Após troca bem-sucedida, atualiza o snapshot da sessão em localStorage
 * (limpa a flag) e redireciona pra /dashboard.
 */
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Eye, EyeOff, Check, X } from 'lucide-react';

import { ApiError } from '@/lib/api';
import { AuthI18nProvider } from '@/lib/auth-i18n-provider';
import { authApi } from '@/lib/auth-api';
import { getSession } from '@/lib/session';
import { NetxLogo } from '@/components/brand/NetxLogo';

interface PasswordCheck {
  /** Chave de tradução em `auth.firstLogin`. */
  key: string;
  test: (v: string) => boolean;
}

const CHECKS: PasswordCheck[] = [
  { key: 'checkMinLength', test: (v) => v.length >= 8 },
  { key: 'checkUpper', test: (v) => /[A-Z]/.test(v) },
  { key: 'checkLower', test: (v) => /[a-z]/.test(v) },
  { key: 'checkDigit', test: (v) => /\d/.test(v) },
  { key: 'checkSymbol', test: (v) => /[^A-Za-z0-9]/.test(v) },
];

export default function FirstLoginPage() {
  return (
    <AuthI18nProvider>
      <FirstLoginForm />
    </AuthI18nProvider>
  );
}

function FirstLoginForm() {
  const t = useTranslations('auth.firstLogin');
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
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

  const passwordChecks = useMemo(
    () =>
      CHECKS.map((c) => ({
        key: c.key,
        passed: newPassword.length > 0 && c.test(newPassword),
      })),
    [newPassword],
  );

  const allChecksPassed = passwordChecks.every((c) => c.passed);
  const passwordsMatch =
    confirmPassword.length > 0 && newPassword === confirmPassword;
  const sameAsCurrent =
    newPassword.length > 0 && newPassword === currentPassword;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!passwordsMatch) {
      setErr(t('errNoMatch'));
      return;
    }
    if (!allChecksPassed) {
      setErr(t('errRequirements'));
      return;
    }
    if (sameAsCurrent) {
      setErr(t('errSameAsCurrent'));
      return;
    }
    setLoading(true);
    try {
      await authApi.changePassword(currentPassword, newPassword);
      const raw = localStorage.getItem('netx.user');
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          parsed.mustChangePassword = false;
          localStorage.setItem('netx.user', JSON.stringify(parsed));
        } catch {
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
        <div className="text-sm text-slate-500">{t('checkingSession')}</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900 px-4 py-8">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-md rounded-xl shadow-xl bg-white dark:bg-slate-800 p-8 space-y-4"
      >
        <div className="mb-2 flex justify-center">
          <NetxLogo variant="auto" className="h-7" />
        </div>
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-bold">{t('title')}</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {t('subtitle')}
          </p>
        </div>

        {/* Senha atual */}
        <div>
          <label className="block text-sm font-medium mb-1">
            {t('currentPassword')}
          </label>
          <div className="relative">
            <input
              type={showCurrent ? 'text' : 'password'}
              autoComplete="current-password"
              className="w-full px-3 py-2 pr-10 rounded-md border border-slate-300 dark:border-slate-600 bg-transparent"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              autoFocus
            />
            <button
              type="button"
              onClick={() => setShowCurrent((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
              aria-label={showCurrent ? t('hidePassword') : t('showPassword')}
              tabIndex={-1}
            >
              {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {/* Nova senha */}
        <div>
          <label className="block text-sm font-medium mb-1">
            {t('newPassword')}
          </label>
          <div className="relative">
            <input
              type={showNew ? 'text' : 'password'}
              autoComplete="new-password"
              className="w-full px-3 py-2 pr-10 rounded-md border border-slate-300 dark:border-slate-600 bg-transparent"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
            />
            <button
              type="button"
              onClick={() => setShowNew((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
              aria-label={showNew ? t('hidePassword') : t('showPassword')}
              tabIndex={-1}
            >
              {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {/* Checklist de requisitos */}
          {newPassword.length > 0 && (
            <ul className="mt-2 space-y-1">
              {passwordChecks.map((c) => (
                <li
                  key={c.key}
                  className={`flex items-center gap-1.5 text-xs ${
                    c.passed
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {c.passed ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <X className="h-3.5 w-3.5" />
                  )}
                  {t(c.key)}
                </li>
              ))}
            </ul>
          )}
          {sameAsCurrent && (
            <p className="mt-2 text-xs text-red-600">{t('sameAsCurrent')}</p>
          )}
        </div>

        {/* Confirmar nova senha */}
        <div>
          <label className="block text-sm font-medium mb-1">
            {t('confirmPassword')}
          </label>
          <div className="relative">
            <input
              type={showConfirm ? 'text' : 'password'}
              autoComplete="new-password"
              className="w-full px-3 py-2 pr-10 rounded-md border border-slate-300 dark:border-slate-600 bg-transparent"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
            <button
              type="button"
              onClick={() => setShowConfirm((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
              aria-label={showConfirm ? t('hidePassword') : t('showPassword')}
              tabIndex={-1}
            >
              {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {confirmPassword.length > 0 && (
            <p
              className={`mt-2 flex items-center gap-1.5 text-xs ${
                passwordsMatch
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-red-600'
              }`}
            >
              {passwordsMatch ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <X className="h-3.5 w-3.5" />
              )}
              {passwordsMatch ? t('passwordsMatch') : t('passwordsNoMatch')}
            </p>
          )}
        </div>

        {err && (
          <div className="text-sm text-red-600 bg-red-50 dark:bg-red-950/40 rounded-md px-3 py-2">
            {err}
          </div>
        )}

        <button
          disabled={loading || !allChecksPassed || !passwordsMatch || sameAsCurrent}
          className="w-full py-2.5 rounded-md bg-brand-600 text-white font-semibold hover:bg-brand-700 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {loading ? t('submitting') : t('submit')}
        </button>

        <p className="text-[11px] text-center text-slate-400 pt-2">
          © 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA
        </p>
      </form>
    </main>
  );
}
