'use client';

/**
 * AttenuationTab — aba "Parâmetros" da Tela 3 do FiberMap (spec §10/§5.3).
 *
 * Defaults de atenuação usados por trace, power budget e OTDR quando a
 * conexão não define perda própria. Agrupados em:
 *   Fibra (dB/km, 1310/1490/1550) · Fusão e Conector (dB) ·
 *   Splitters balanceados (1x2..1x64) · Desbalanceados (TAP/PASS por %).
 *
 * Inputs controlados como string (evita NaN durante digitação); badge
 * "alterado" nas chaves em `overridden` (≠ default de fábrica) e "não salvo"
 * nas dirty; Salvar envia patchAttenuation SÓ com as chaves modificadas.
 */
import { RotateCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import useSWR from 'swr';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { fibermapApi, type FibermapAttenuationKey } from '@/lib/fibermap-api';

import { toDecimal } from './catalog-shared';

const FIBER_KEYS: readonly FibermapAttenuationKey[] = [
  'FIBER_1310',
  'FIBER_1490',
  'FIBER_1550',
];

const EVENT_KEYS: readonly FibermapAttenuationKey[] = ['FUSION', 'CONNECTOR_PAIR'];

const BALANCED_KEYS: readonly FibermapAttenuationKey[] = [
  'SPLITTER_1_2',
  'SPLITTER_1_4',
  'SPLITTER_1_8',
  'SPLITTER_1_16',
  'SPLITTER_1_32',
  'SPLITTER_1_64',
];

const UNBALANCED_ROWS: ReadonlyArray<{
  percent: number;
  tap: FibermapAttenuationKey;
  pass: FibermapAttenuationKey;
}> = [
  { percent: 10, tap: 'UNBALANCED_10_TAP', pass: 'UNBALANCED_10_PASS' },
  { percent: 20, tap: 'UNBALANCED_20_TAP', pass: 'UNBALANCED_20_PASS' },
  { percent: 30, tap: 'UNBALANCED_30_TAP', pass: 'UNBALANCED_30_PASS' },
  { percent: 50, tap: 'UNBALANCED_50_TAP', pass: 'UNBALANCED_50_PASS' },
];

type Draft = Partial<Record<FibermapAttenuationKey, string>>;

export function AttenuationTab({ canAdmin }: { canAdmin: boolean }) {
  const t = useTranslations('fibermap');
  const tCommon = useTranslations('common');

  const { data, error, isLoading, mutate } = useSWR('fibermap-attenuation', () =>
    fibermapApi.getAttenuation(),
  );

  const [draft, setDraft] = useState<Draft>({});
  const [saving, setSaving] = useState(false);

  /** Chaves realmente modificadas (parseáveis e ≠ valor atual do servidor). */
  const dirtyKeys = useMemo<FibermapAttenuationKey[]>(() => {
    if (!data) return [];
    return (Object.keys(draft) as FibermapAttenuationKey[]).filter((k) => {
      const raw = draft[k];
      if (raw === undefined) return false;
      const n = toDecimal(raw);
      return n !== null && n !== data.values[k];
    });
  }, [draft, data]);

  /** Chaves com texto que não vira número válido ≥ 0. */
  const invalidKeys = useMemo<Set<FibermapAttenuationKey>>(() => {
    const out = new Set<FibermapAttenuationKey>();
    for (const k of Object.keys(draft) as FibermapAttenuationKey[]) {
      const raw = draft[k];
      if (raw === undefined) continue;
      const n = toDecimal(raw);
      if (n === null || n < 0 || n > 100) out.add(k);
    }
    return out;
  }, [draft]);

  function setValue(key: FibermapAttenuationKey, raw: string) {
    setDraft((prev) => ({ ...prev, [key]: raw }));
  }

  async function handleSave() {
    if (!data || dirtyKeys.length === 0) return;
    if (invalidKeys.size > 0) {
      toast.error(t('settings.attenuation.invalid'));
      return;
    }
    setSaving(true);
    try {
      const patch: Partial<Record<FibermapAttenuationKey, number>> = {};
      for (const k of dirtyKeys) {
        const n = toDecimal(draft[k] ?? '');
        if (n !== null) patch[k] = n;
      }
      const result = await fibermapApi.patchAttenuation(patch);
      await mutate(result, { revalidate: false });
      setDraft({});
      toast.success(t('settings.attenuation.saved'));
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.friendlyMessage : t('settings.genericError'),
      );
    } finally {
      setSaving(false);
    }
  }

  if (isLoading || (!data && !error)) {
    return <PageLoader label={tCommon('loading')} />;
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-surface px-6 py-12 text-center">
        <p className="text-sm text-text-muted">{t('settings.attenuation.loadError')}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void mutate();
          }}
        >
          <RotateCw className="h-3.5 w-3.5" />
          {t('settings.attenuation.retry')}
        </Button>
      </div>
    );
  }

  const renderInput = (key: FibermapAttenuationKey, ariaLabel: string) => {
    const raw = draft[key] ?? String(data.values[key]);
    const invalid = invalidKeys.has(key);
    return (
      <Input
        type="number"
        step="0.01"
        min={0}
        value={raw}
        disabled={!canAdmin}
        onChange={(e) => setValue(key, e.target.value)}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        className={cn('w-24 text-right', invalid && 'border-danger')}
      />
    );
  };

  const renderBadges = (key: FibermapAttenuationKey) => (
    <>
      {data.overridden.includes(key) && (
        <Badge tone="info">{t('settings.attenuation.overridden')}</Badge>
      )}
      {dirtyKeys.includes(key) && (
        <Badge tone="warning">{t('settings.attenuation.unsaved')}</Badge>
      )}
    </>
  );

  const renderRow = (key: FibermapAttenuationKey, unit: string) => {
    const label = t(`settings.attenuation.keys.${key}`);
    return (
      <div key={key} className="flex items-center justify-between gap-3 px-4 py-2.5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-sm text-text">{label}</span>
          {renderBadges(key)}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {renderInput(key, label)}
          <span className="w-12 text-xs text-text-subtle">{unit}</span>
        </div>
      </div>
    );
  };

  const groupCard = (titleKey: string, children: React.ReactNode) => (
    <section className="overflow-hidden rounded-lg border border-border bg-surface shadow-xs">
      <header className="border-b border-border bg-surface-muted/60 px-4 py-2.5">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-text-subtle">
          {t(titleKey)}
        </h3>
      </header>
      <div className="divide-y divide-border">{children}</div>
    </section>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-text">
            {t('settings.attenuation.title')}
          </h2>
          <p className="text-sm text-text-muted">
            {t('settings.attenuation.subtitle')}
          </p>
        </div>
        {canAdmin && (
          <div className="flex items-center gap-3">
            {dirtyKeys.length > 0 && (
              <span className="text-xs text-text-muted">
                {t('settings.attenuation.dirtyCount', { count: dirtyKeys.length })}
              </span>
            )}
            <Button
              onClick={() => {
                void handleSave();
              }}
              loading={saving}
              disabled={dirtyKeys.length === 0 || invalidKeys.size > 0}
            >
              {t('settings.attenuation.save')}
            </Button>
          </div>
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {groupCard(
          'settings.attenuation.groups.fiber',
          FIBER_KEYS.map((k) => renderRow(k, 'dB/km')),
        )}
        {groupCard(
          'settings.attenuation.groups.events',
          EVENT_KEYS.map((k) => renderRow(k, 'dB')),
        )}
        {groupCard(
          'settings.attenuation.groups.balanced',
          BALANCED_KEYS.map((k) => renderRow(k, 'dB')),
        )}
        {groupCard(
          'settings.attenuation.groups.unbalanced',
          <>
            <div className="grid grid-cols-[1fr_auto_auto] items-center gap-3 px-4 py-2 text-2xs font-semibold uppercase tracking-wider text-text-subtle">
              <span />
              <span className="w-24 text-right">
                {t('settings.attenuation.tapCol')}
              </span>
              <span className="w-24 text-right">
                {t('settings.attenuation.passCol')}
              </span>
            </div>
            {UNBALANCED_ROWS.map((row) => (
              <div
                key={row.percent}
                className="grid grid-cols-[1fr_auto_auto] items-center gap-3 px-4 py-2.5"
              >
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="text-sm text-text">
                    {t('settings.attenuation.unbalancedRow', {
                      percent: row.percent,
                    })}
                  </span>
                  {renderBadges(row.tap)}
                  {renderBadges(row.pass)}
                </div>
                {renderInput(
                  row.tap,
                  `${t('settings.attenuation.unbalancedRow', { percent: row.percent })} — ${t('settings.attenuation.tapCol')}`,
                )}
                {renderInput(
                  row.pass,
                  `${t('settings.attenuation.unbalancedRow', { percent: row.percent })} — ${t('settings.attenuation.passCol')}`,
                )}
              </div>
            ))}
          </>,
        )}
      </div>
    </div>
  );
}
