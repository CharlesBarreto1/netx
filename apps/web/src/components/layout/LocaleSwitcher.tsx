'use client';

import { Globe, Check } from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'next-intl';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from '@/components/ui/sonner';
import {
  APP_LOCALE_LABEL,
  APP_LOCALES,
  isAppLocale,
  type AppLocale,
} from '@/i18n';
import { ApiError } from '@/lib/api';
import { useTenantConfig } from '@/lib/tenant-config';

/**
 * LocaleSwitcher — dropdown na topbar pra trocar idioma do user logado.
 *
 * Estratégia:
 *   - Lista os idiomas suportados pela operação (vem do preset do país)
 *     intersected com APP_LOCALES (idiomas que temos dictionary).
 *   - Mostra o idioma efetivo com check.
 *   - "Padrão da operação" reseta `user.locale` pra null — passa a usar
 *     `tenant.locale` (útil quando o admin trocou o idioma da operação).
 */
export function LocaleSwitcher() {
  const t = useTranslations('nav');
  const { effectiveLocale, preset, user, setUserLocale } = useTenantConfig();
  const [busy, setBusy] = useState(false);

  // Locales disponíveis pra escolha = preset.supportedLocales ∩ APP_LOCALES
  const available: AppLocale[] = (preset.supportedLocales ?? [])
    .filter(isAppLocale)
    .filter((l, i, arr) => arr.indexOf(l) === i);
  // Garantir que pelo menos os APP_LOCALES estejam disponíveis (fallback).
  const finalLocales = available.length > 0 ? available : APP_LOCALES;

  async function pick(locale: AppLocale | null) {
    if (busy) return;
    setBusy(true);
    try {
      await setUserLocale(locale);
    } catch (err) {
      const msg = err instanceof ApiError ? err.friendlyMessage : 'Erro ao trocar idioma';
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
        aria-label={t('language')}
      >
        <Globe className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[220px]">
        <DropdownMenuLabel>{t('language')}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {finalLocales.map((loc) => {
          const active = effectiveLocale === loc && !!user?.locale;
          return (
            <DropdownMenuItem
              key={loc}
              onSelect={(e) => {
                e.preventDefault();
                void pick(loc);
              }}
              className="flex items-center gap-2"
            >
              <span className="flex-1">{APP_LOCALE_LABEL[loc]}</span>
              {active && <Check className="h-3.5 w-3.5 text-accent" />}
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            void pick(null);
          }}
          className="flex items-center gap-2 text-text-muted"
        >
          <span className="flex-1">{t('tenantDefault')}</span>
          {!user?.locale && <Check className="h-3.5 w-3.5 text-accent" />}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
