'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Eye, EyeOff } from 'lucide-react';

import { ApiError, apiLogin } from '@/lib/api';
import { AuthI18nProvider } from '@/lib/auth-i18n-provider';
import { getSession } from '@/lib/session';
import { NetxLogo } from '@/components/brand/NetxLogo';

/**
 * Tela de login — raiz efetiva do sistema para quem não está logado (o `/`
 * redireciona pra cá; ver app/page.tsx). Layout split-screen: painel de marca
 * à esquerda (só ≥lg) + formulário à direita.
 *
 * Quando o user tem 2FA ativo, o backend devolve 401 com
 * `type: 'urn:netx:error:mfa-required'` e mostramos o campo de token TOTP.
 * Próxima tentativa de submit reenvia email/senha + mfaToken.
 *
 * É pré-login (sem tenant), então o i18n vem do `AuthI18nProvider` (idioma do
 * navegador → es-PY default), não do `I18nProvider` baseado em tenant.
 */
export default function LoginPage() {
  return (
    <AuthI18nProvider>
      <LoginLayout />
    </AuthI18nProvider>
  );
}

function LoginLayout() {
  return (
    <main className="grid min-h-screen bg-bg lg:grid-cols-[1.05fr_1fr]">
      <BrandPanel />
      <FormPanel />
    </main>
  );
}

/**
 * Painel de marca (esquerda). Gradiente azul sempre-escuro — independe do tema
 * do resto do app — com motivo de rede sutil, headline/subhead reaproveitados
 * do antigo hotsite (chaves `landing.*`) e assinatura de copyright no rodapé.
 * Escondido em telas <lg pra não roubar espaço do formulário no mobile.
 */
function BrandPanel() {
  const t = useTranslations('auth.login');
  const tl = useTranslations('landing');

  return (
    <aside className="relative hidden overflow-hidden bg-[#04060c] lg:flex lg:flex-col lg:justify-between lg:p-12 xl:p-16">
      {/* Base: azul (canto inferior-direito) escurecendo pro topo-esquerdo. */}
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-br from-[hsl(219_74%_15%)] via-[hsl(217_82%_24%)] to-[hsl(213_86%_36%)]"
      />
      {/* Escurecimento SUTIL no canto do logo (topo-esquerdo) — só o suficiente
          pra dar contraste, sem virar um bloco preto; + brilho azul embaixo. */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(55% 55% at 4% 2%, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.2) 34%, transparent 62%),' +
            'radial-gradient(640px 470px at 116% 118%, hsl(210 100% 55% / 0.22), transparent 55%)',
        }}
      />
      {/* Grade de pontos — evoca topologia de rede; puxada pro lado direito
          pra deixar o canto do logo limpo. */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.12]"
        style={{
          backgroundImage:
            'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.9) 1px, transparent 0)',
          backgroundSize: '28px 28px',
          maskImage: 'radial-gradient(ellipse 90% 90% at 82% 88%, #000 28%, transparent 74%)',
        }}
      />

      {/* Topo: logotipo NetX (NET branco — fundo escuro) */}
      <div className="relative">
        <NetxLogo variant="onDark" className="h-9" />
      </div>

      {/* Meio: pitch */}
      <div className="relative max-w-lg">
        <span className="inline-flex items-center rounded-full bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-brand-100 ring-1 ring-white/15 backdrop-blur">
          {t('panelBadge')}
        </span>
        <h1 className="mt-6 text-4xl font-bold leading-tight tracking-tight text-white xl:text-5xl">
          {tl('headline')}
        </h1>
        <p className="mt-5 text-base leading-relaxed text-brand-100/80">
          {tl('subhead')}
        </p>
      </div>

      {/* Rodapé: copyright */}
      <div className="relative text-xs text-brand-100/50">
        © 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA
      </div>
    </aside>
  );
}

/**
 * Painel do formulário (direita). Segue o tema do app (escuro por padrão).
 * Mantém intacta toda a lógica de auth: session check + redirect, apiLogin,
 * persistência em localStorage, mustChangePassword → /first-login e o fluxo MFA.
 */
function FormPanel() {
  const t = useTranslations('auth.login');
  const router = useRouter();
  // Sem pré-preenchimento de admin@netx — o campo começa vazio.
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  // Vazio por padrão — o backend cai no DEFAULT_TENANT_SLUG do .env quando
  // tenantSlug não é enviado. Cada instância NetX = um ISP = um tenant.
  const [tenantSlug] = useState('');
  const [mfaToken, setMfaToken] = useState('');
  const [needsMfa, setNeedsMfa] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Login persistente: quem já tem sessão não deve ver a tela de login.
  // Enquanto checamos (e possivelmente redirecionamos), não pintamos o form
  // pra evitar flash. Se o token estiver expirado, o interceptor de API faz
  // refresh ao entrar no app; se o refresh falhar, cai de volta aqui.
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    if (getSession()) {
      router.replace('/dashboard');
    } else {
      setCheckingSession(false);
    }
  }, [router]);

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

  // Sessão ativa → redirecionando pro app; não pinta o form.
  if (checkingSession) {
    return <section className="min-h-screen bg-white" />;
  }

  // O painel do formulário é SEMPRE claro (fundo branco), independente do tema
  // do app — como na referência (Hubsoft). Por isso usamos cores fixas (slate/
  // brand) em vez dos tokens semânticos que trocam com `.dark`.
  return (
    <section className="flex min-h-screen flex-col justify-center bg-white px-6 py-12 sm:px-10">
      <div className="mx-auto w-full max-w-sm">
        {/* Logotipo — NET preto, pois o fundo é sempre branco. */}
        <div className="mb-8">
          <NetxLogo variant="onLight" className="h-8" />
        </div>

        <h2 className="text-2xl font-bold tracking-tight text-slate-900">{t('title')}</h2>
        <p className="mt-1.5 text-sm text-slate-500">{t('subtitle')}</p>

        <form onSubmit={onSubmit} className="mt-8 space-y-5">
          <div>
            <label
              htmlFor="login-email"
              className="mb-1.5 block text-sm font-medium text-slate-700"
            >
              {t('email')}
            </label>
            <input
              id="login-email"
              type="email"
              autoComplete="username"
              autoFocus
              className="block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-xs transition-colors placeholder:text-slate-400 focus:border-brand-500 focus:outline-hidden focus:ring-2 focus:ring-brand-500/30 disabled:cursor-not-allowed disabled:opacity-60"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="voce@provedor.com"
              required
              disabled={needsMfa}
            />
          </div>

          <div>
            <label
              htmlFor="login-password"
              className="mb-1.5 block text-sm font-medium text-slate-700"
            >
              {t('password')}
            </label>
            <div className="relative">
              <input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                className="block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 pr-11 text-sm text-slate-900 shadow-xs transition-colors placeholder:text-slate-400 focus:border-brand-500 focus:outline-hidden focus:ring-2 focus:ring-brand-500/30 disabled:cursor-not-allowed disabled:opacity-60"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                disabled={needsMfa}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                tabIndex={-1}
                aria-label={showPassword ? t('hidePassword') : t('showPassword')}
                className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 transition-colors hover:text-slate-600 disabled:opacity-40"
                disabled={needsMfa}
              >
                {showPassword ? (
                  <EyeOff className="h-4.5 w-4.5" aria-hidden />
                ) : (
                  <Eye className="h-4.5 w-4.5" aria-hidden />
                )}
              </button>
            </div>
          </div>

          {needsMfa && (
            <div>
              <label
                htmlFor="login-mfa"
                className="mb-1.5 block text-sm font-medium text-slate-700"
              >
                {t('mfaLabel')}
              </label>
              <input
                id="login-mfa"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                maxLength={8}
                className="block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 font-mono text-sm tracking-[0.4em] text-slate-900 shadow-xs transition-colors placeholder:tracking-normal placeholder:text-slate-400 focus:border-brand-500 focus:outline-hidden focus:ring-2 focus:ring-brand-500/30"
                value={mfaToken}
                onChange={(e) => setMfaToken(e.target.value.replace(/[\s-]/gu, ''))}
                placeholder="000000"
                required
              />
              <p className="mt-1.5 text-xs text-slate-500">{t('mfaHelp')}</p>
            </div>
          )}

          {err && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700"
            >
              {err}
            </div>
          )}

          <button
            disabled={loading || (needsMfa && mfaToken.length < 6)}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500/50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading && (
              <svg
                className="h-4 w-4 animate-spin"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                aria-hidden
              >
                <circle className="opacity-25" cx="12" cy="12" r="10" />
                <path className="opacity-75" d="M4 12a8 8 0 018-8" />
              </svg>
            )}
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
              className="w-full text-xs text-slate-500 transition-colors hover:text-slate-700"
            >
              {t('back')}
            </button>
          )}
        </form>
      </div>
    </section>
  );
}
