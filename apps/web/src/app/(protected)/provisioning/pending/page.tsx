'use client';

/**
 * /provisioning/pending — lista de contratos PENDING_INSTALL.
 * Técnico em campo abre essa página no celular pra escolher o cliente que
 * vai ativar agora.
 */
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import {
  provisioningApi,
  type PendingInstallItem,
} from '@/lib/provisioning-api';
import type { Paginated } from '@/lib/crm-types';
import { hasPermission } from '@/lib/session';

function fmtCurrency(v: string): string {
  const n = Number(v);
  if (Number.isNaN(n)) return v;
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export default function PendingInstallsPage() {
  const t = useTranslations('provisioning.pending');
  const [search, setSearch] = useState('');
  const canInstall = hasPermission('provisioning.write');

  function fmtRelative(iso: string): string {
    const d = new Date(iso).getTime();
    const diff = Date.now() - d;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    if (days <= 0) return t('relativeToday');
    if (days === 1) return t('relativeYesterday');
    return t('relativeDaysAgo', { days });
  }

  const { data, isLoading, error } = useSWR<Paginated<PendingInstallItem>>(
    ['provisioning/pending', search],
    () => provisioningApi.listPending({ pageSize: 100, search: search || undefined }),
    { refreshInterval: 30_000 },
  );

  if (isLoading) return <PageLoader />;
  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
        {t('loadError')}
      </div>
    );
  }

  const items = data?.data ?? [];

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {t('subtitle')}
        </p>
      </header>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input
          placeholder={t('searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="sm:max-w-md"
        />
        <span className="text-sm text-slate-500 dark:text-slate-400">
          {t('pendingCount', { count: items.length })}
        </span>
      </div>

      {items.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-10 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
          {t('empty')}
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((c) => (
            <li
              key={c.contractId}
              className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-semibold">{c.customerName}</h3>
                    {c.contractCode && (
                      <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        {c.contractCode}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-slate-600 dark:text-slate-300">
                    {c.installationAddress}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {c.bandwidthMbps} Mbps • {fmtCurrency(c.monthlyValue)} •{' '}
                    {t('createdRelative', { when: fmtRelative(c.createdAt) })}
                  </p>
                </div>
                {canInstall && (
                  <Link
                    href={`/provisioning/install/${c.contractId}`}
                    className="inline-flex"
                  >
                    <Button>{t('activate')}</Button>
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
