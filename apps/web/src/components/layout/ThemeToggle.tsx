'use client';

/**
 * ThemeToggle — botão claro/escuro na topbar, ao lado do LocaleSwitcher.
 *
 * Persiste em localStorage['netx.theme'] ('light' | 'dark'). O script
 * anti-FOUC em layout.tsx lê esse valor no boot. Aqui só alternamos em
 * runtime + sincronizamos o estado visual do ícone.
 *
 * @provenance Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=
 */
import { Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

const STORAGE_KEY = 'netx.theme';

export function ThemeToggle() {
  const t = useTranslations('nav');
  // Inicia como null pra evitar mismatch de hydration — o ícone só renderiza
  // depois do mount, quando sabemos o tema real do DOM.
  const [dark, setDark] = useState<boolean | null>(null);

  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'));
  }, []);

  function toggle() {
    const next = !(dark ?? false);
    setDark(next);
    const el = document.documentElement;
    el.classList.toggle('dark', next);
    el.classList.toggle('light', !next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? 'dark' : 'light');
    } catch {
      /* localStorage indisponível (modo privado) — tema não persiste, ok */
    }
  }

  // Placeholder do mesmo tamanho enquanto não montou (evita layout shift).
  if (dark === null) {
    return <div className="h-8 w-8" aria-hidden />;
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={t('toggleTheme')}
      title={t('toggleTheme')}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
    >
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
