'use client';

/**
 * /mapping/customers — mapa interativo de clientes.
 *
 * Carrega pontos via /v1/mapping/customers + refresh 60s pra atualizar
 * status online. Mapa é client-only (dynamic import sem SSR).
 */
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import useSWR from 'swr';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import {
  mappingApi,
  type CustomerMapPoint,
  type CustomerMapResponse,
  type ListCustomerMapParams,
} from '@/lib/mapping-api';
import { useTenantConfig } from '@/lib/tenant-config';
import type { ContractStatus } from '@/lib/contracts-api';

// react-leaflet quebra no SSR (window undefined). Carregamento client-only.
const CustomerMap = dynamic(
  () => import('@/components/mapping/CustomerMap').then((m) => m.CustomerMap),
  { ssr: false, loading: () => <div className="h-[600px] animate-pulse rounded-lg bg-surface-muted" /> },
);

const ALL_STATUSES: Array<{ value: ContractStatus; labelKey: string }> = [
  { value: 'ACTIVE', labelKey: 'statusActive' },
  { value: 'SUSPENDED', labelKey: 'statusSuspended' },
  { value: 'PENDING_INSTALL', labelKey: 'statusPendingInstall' },
  { value: 'CANCELLED', labelKey: 'statusCancelled' },
];

export default function MappingCustomersPage() {
  const t = useTranslations('mapping.customers');
  const tenantConfig = useTenantConfig();
  const country = tenantConfig?.tenant?.country ?? null;

  const [selectedStatuses, setSelectedStatuses] = useState<ContractStatus[]>([
    'ACTIVE',
    'SUSPENDED',
    'PENDING_INSTALL',
  ]);
  const [onlineOnly, setOnlineOnly] = useState(false);
  const [search, setSearch] = useState('');

  const params: ListCustomerMapParams = {
    status: selectedStatuses,
    onlineOnly: onlineOnly || undefined,
  };
  const { data, isLoading } = useSWR<CustomerMapResponse>(
    mappingApi.customersPath(params),
    () => mappingApi.listCustomers(params),
    { refreshInterval: 60_000 }, // 1 min: status online atualiza sozinho
  );

  if (isLoading || !data) return <PageLoader />;

  // Filtro client-side por busca textual (nome ou código). Evita round-trip.
  const filteredPoints = search.trim()
    ? data.points.filter((p) => {
        const q = search.trim().toLowerCase();
        return (
          p.customerName.toLowerCase().includes(q) ||
          (p.code ?? '').toLowerCase().includes(q) ||
          (p.radiusIdentifier ?? '').toLowerCase().includes(q)
        );
      })
    : data.points;

  const stats = data.stats;
  const center = countryCenter(country);

  function toggleStatus(s: ContractStatus) {
    setSelectedStatuses((arr) =>
      arr.includes(s) ? arr.filter((x) => x !== s) : [...arr, s],
    );
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-text-muted">{t('subtitle')}</p>
        </div>
        <div className="text-xs text-text-muted">
          {t('refreshLine', { shown: filteredPoints.length, total: stats.total })}
        </div>
      </header>

      {/* Stats cards */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        <StatCard label={t('statMapped')} value={stats.total} tone="neutral" />
        <StatCard label={t('statOnline')} value={stats.online} tone="success" />
        <StatCard label={t('statOffline')} value={stats.offline} tone="danger" />
        <StatCard label={t('statSuspended')} value={stats.suspended} tone="warning" />
        <StatCard label={t('statPendingInstall')} value={stats.pendingInstall} tone="info" />
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface p-3 text-sm">
        <div className="flex flex-wrap gap-1.5">
          {ALL_STATUSES.map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={() => toggleStatus(s.value)}
              className={
                'rounded-md border px-2 py-1 text-xs transition-colors ' +
                (selectedStatuses.includes(s.value)
                  ? 'border-accent bg-accent-muted text-text'
                  : 'border-border text-text-muted hover:bg-surface-hover')
              }
            >
              {t(s.labelKey)}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-xs text-text">
          <input
            type="checkbox"
            checked={onlineOnly}
            onChange={(e) => setOnlineOnly(e.target.checked)}
          />
          {t('onlineOnly')}
        </label>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('searchPlaceholder')}
          className="ml-auto max-w-xs"
        />
      </div>

      {/* Mapa */}
      {filteredPoints.length === 0 && stats.total === 0 ? (
        <EmptyState />
      ) : filteredPoints.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface p-10 text-center text-sm text-text-muted">
          {t('noMatch')}
        </div>
      ) : (
        <CustomerMap points={filteredPoints} center={center} height="calc(100vh - 380px)" />
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'neutral' | 'success' | 'danger' | 'warning' | 'info';
}) {
  const toneColor: Record<typeof tone, string> = {
    neutral: 'text-text',
    success: 'text-emerald-600 dark:text-emerald-400',
    danger: 'text-rose-600 dark:text-rose-400',
    warning: 'text-amber-600 dark:text-amber-400',
    info: 'text-blue-600 dark:text-blue-400',
  };
  return (
    <div className="rounded-md border border-border bg-surface p-3">
      <div className="text-xs text-text-muted">{label}</div>
      <div className={'text-2xl font-bold ' + toneColor[tone]}>{value}</div>
    </div>
  );
}

function EmptyState() {
  const t = useTranslations('mapping.customers');
  return (
    <div className="rounded-lg border border-dashed border-border bg-surface p-10 text-center">
      <div className="text-base font-medium text-text">{t('emptyTitle')}</div>
      <p className="mx-auto mt-2 max-w-md text-sm text-text-muted">
        {t.rich('emptyBody', {
          link: (chunks) => (
            <Link href="/contracts" className="text-brand-500 hover:underline">
              {chunks}
            </Link>
          ),
        })}
      </p>
    </div>
  );
}

function countryCenter(country: string | null): [number, number] {
  switch (country) {
    case 'PY':
      return [-25.2637, -57.5759]; // Asunción
    case 'BR':
      return [-23.5505, -46.6333]; // São Paulo
    default:
      return [-15, -55]; // Brasil/PY zoom 4
  }
}
