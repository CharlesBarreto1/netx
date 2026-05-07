'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/Button';
import { FieldHelp, Input, Label, Select } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import { toast } from '@/components/ui/sonner';
import { ApiError, api } from '@/lib/api';
import { useTenantConfig, type TenantMe } from '@/lib/tenant-config';
import {
  COUNTRY_PRESETS,
  SUPPORTED_COUNTRIES,
  getCountryPreset,
} from '@netx/shared';
import { hasPermission } from '@/lib/session';

/**
 * /settings/tenant — parametrização da operação (= a empresa/ISP inteira).
 *
 * Conceito: cada instância NetX atende **uma única ISP**. O `Tenant` no
 * banco representa essa empresa (não é multi-tenant SaaS-style — esse
 * modelo foi descartado por exigências do RADIUS, ver
 * `docs/architecture/tenancy.md`).
 *
 * Quem decide o país também decide locale, moeda e fuso default — mas pode
 * sobrescrever cada um individualmente. O check "Aplicar padrões do país"
 * pré-preenche os 3 campos derivados ao trocar o país.
 *
 * Permissão: `tenants.update` (admin da operação).
 */
export default function TenantSettingsPage() {
  const t = useTranslations('settings');
  const tCommon = useTranslations('common');
  const { tenant, isLoading } = useTenantConfig();
  const canUpdate = hasPermission('tenants.update');

  const [form, setForm] = useState<{
    country: string;
    locale: string;
    currency: string;
    timezone: string;
    name: string;
    legalName: string;
    taxId: string;
    applyCountryDefaults: boolean;
  }>({
    country: 'PY',
    locale: 'es-PY',
    currency: 'PYG',
    timezone: 'America/Asuncion',
    name: '',
    legalName: '',
    taxId: '',
    applyCountryDefaults: false,
  });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!tenant) return;
    setForm((s) => ({
      ...s,
      country: tenant.country,
      locale: tenant.locale,
      currency: tenant.currency,
      timezone: tenant.timezone,
      name: tenant.name,
      legalName: tenant.legalName ?? '',
      taxId: tenant.taxId ?? '',
    }));
  }, [tenant]);

  if (isLoading || !tenant) {
    return <PageLoader />;
  }

  function onCountryChange(next: string) {
    const preset = getCountryPreset(next);
    setForm((s) => {
      // Se "applyCountryDefaults" tá marcado, atualiza locale/currency/timezone
      // pra refletir o preset visualmente. Se não, só troca o country.
      if (s.applyCountryDefaults) {
        return {
          ...s,
          country: next,
          locale: preset.locale,
          currency: preset.currency,
          timezone: preset.timezone,
        };
      }
      return { ...s, country: next };
    });
  }

  function toggleApplyDefaults() {
    setForm((s) => {
      const apply = !s.applyCountryDefaults;
      if (apply) {
        const preset = getCountryPreset(s.country);
        return {
          ...s,
          applyCountryDefaults: true,
          locale: preset.locale,
          currency: preset.currency,
          timezone: preset.timezone,
        };
      }
      return { ...s, applyCountryDefaults: false };
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canUpdate || submitting) return;
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        name: form.name,
        legalName: form.legalName || null,
        taxId: form.taxId || null,
        country: form.country,
        locale: form.locale,
        currency: form.currency,
        timezone: form.timezone,
      };
      if (form.applyCountryDefaults) body.applyCountryDefaults = true;
      await api.patch<TenantMe>('/v1/tenants/me', body);
      toast.success(tCommon('success'));
      // Recarrega pra propagar locale/currency em toda a app.
      window.location.reload();
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.friendlyMessage : (err as Error).message;
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  const preset = getCountryPreset(form.country);

  return (
    <div className="space-y-5">
      <header>
        <nav className="text-xs text-slate-500 dark:text-slate-400">
          <Link href="/dashboard" className="hover:underline">
            {tCommon('back')}
          </Link>
        </nav>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">{t('tenant.title')}</h1>
        <p className="mt-1 max-w-2xl text-sm text-text-muted">
          {t('tenant.subtitle')}
        </p>
      </header>

      <form
        onSubmit={handleSubmit}
        className="space-y-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800"
      >
        <h2 className="text-base font-semibold">{t('tenant.title')}</h2>
        <p className="text-xs text-text-muted">{t('tenant.legalNote')}</p>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <Label htmlFor="t-name" required>
              Nome
            </Label>
            <Input
              id="t-name"
              value={form.name}
              onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
              disabled={!canUpdate}
            />
          </div>
          <div>
            <Label htmlFor="t-legalName">Razão social</Label>
            <Input
              id="t-legalName"
              value={form.legalName}
              onChange={(e) => setForm((s) => ({ ...s, legalName: e.target.value }))}
              disabled={!canUpdate}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <Label htmlFor="t-country" required>
              {t('tenant.country')}
            </Label>
            <Select
              id="t-country"
              value={form.country}
              onChange={(e) => onCountryChange(e.target.value)}
              disabled={!canUpdate}
            >
              {SUPPORTED_COUNTRIES.map((code) => {
                const p = COUNTRY_PRESETS[code];
                return (
                  <option key={code} value={code}>
                    {p?.name ?? code} ({code})
                  </option>
                );
              })}
            </Select>
            <FieldHelp>
              {preset.taxIdTypes.join(' / ')} · {preset.currency} · {preset.timezone}
            </FieldHelp>
          </div>
          <div>
            <Label htmlFor="t-taxId">Documento fiscal da empresa</Label>
            <Input
              id="t-taxId"
              value={form.taxId}
              onChange={(e) => setForm((s) => ({ ...s, taxId: e.target.value }))}
              placeholder={preset.taxIdTypes[0]}
              disabled={!canUpdate}
            />
          </div>
        </div>

        <div>
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.applyCountryDefaults}
              onChange={toggleApplyDefaults}
              disabled={!canUpdate}
              className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
            />
            <span>{t('tenant.applyDefaults')}</span>
          </label>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <Label htmlFor="t-locale">{t('tenant.locale')}</Label>
            <Input
              id="t-locale"
              value={form.locale}
              onChange={(e) => setForm((s) => ({ ...s, locale: e.target.value }))}
              placeholder="pt-BR"
              disabled={!canUpdate || form.applyCountryDefaults}
            />
          </div>
          <div>
            <Label htmlFor="t-currency">{t('tenant.currency')}</Label>
            <Input
              id="t-currency"
              value={form.currency}
              onChange={(e) =>
                setForm((s) => ({ ...s, currency: e.target.value.toUpperCase() }))
              }
              placeholder="BRL"
              maxLength={3}
              disabled={!canUpdate || form.applyCountryDefaults}
            />
          </div>
          <div>
            <Label htmlFor="t-timezone">{t('tenant.timezone')}</Label>
            <Input
              id="t-timezone"
              value={form.timezone}
              onChange={(e) => setForm((s) => ({ ...s, timezone: e.target.value }))}
              placeholder="America/Sao_Paulo"
              disabled={!canUpdate || form.applyCountryDefaults}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 pt-4 dark:border-slate-700">
          <Button type="submit" loading={submitting} disabled={!canUpdate}>
            {tCommon('save')}
          </Button>
        </div>
      </form>
    </div>
  );
}
