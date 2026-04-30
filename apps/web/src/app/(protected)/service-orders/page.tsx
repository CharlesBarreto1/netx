'use client';

import Link from 'next/link';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import useSWR from 'swr';

import { ServiceOrderStatusBadge } from '@/components/service-orders/StatusBadge';
import { Button } from '@/components/ui/Button';
import { Input, Label, Select } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import { hasPermission } from '@/lib/session';
import {
  serviceOrdersApi,
  type ServiceOrderDisplayStatus,
  type ServiceOrderResponse,
} from '@/lib/service-orders-api';
import type { Paginated } from '@/lib/crm-types';
import { formatDate } from '@/lib/format';

const STATUS_VALUES: ServiceOrderDisplayStatus[] = [
  'OPEN',
  'SCHEDULED',
  'IN_PROGRESS',
  'OVERDUE',
  'COMPLETED',
  'CANCELLED',
];

/**
 * /service-orders — gestão de O.S.
 * Filtros: status (combo), cidade (contains), range de scheduledAt.
 */
export default function ServiceOrdersListPage() {
  const tSO = useTranslations('serviceOrders');
  const tList = useTranslations('serviceOrders.list');
  const tStatus = useTranslations('serviceOrders.statusLabel');
  const tCommon = useTranslations('common');
  const canCreate = hasPermission('service_orders.write');

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ServiceOrderDisplayStatus | ''>('');
  const [city, setCity] = useState('');
  const [scheduledFrom, setScheduledFrom] = useState('');
  const [scheduledTo, setScheduledTo] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const key = serviceOrdersApi.listPath({
    page,
    pageSize,
    status: status || undefined,
    city: city || undefined,
    search: search || undefined,
    // Convertemos date (YYYY-MM-DD) pra ISO 8601 com offset.
    scheduledFrom: scheduledFrom
      ? new Date(`${scheduledFrom}T00:00:00`).toISOString()
      : undefined,
    scheduledTo: scheduledTo
      ? new Date(`${scheduledTo}T23:59:59`).toISOString()
      : undefined,
  });
  const { data, isLoading, error } = useSWR<Paginated<ServiceOrderResponse>>(key);

  if (isLoading && !data) return <PageLoader label={tCommon('loading')} />;
  if (error) {
    return <p className="text-sm text-red-600">{tCommon('error')}.</p>;
  }

  const rows = data?.data ?? [];

  function clearFilters() {
    setSearch('');
    setStatus('');
    setCity('');
    setScheduledFrom('');
    setScheduledTo('');
    setPage(1);
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{tSO('title')}</h1>
          <p className="text-sm text-text-muted">{tSO('subtitle')}</p>
        </div>
        {canCreate && (
          <Link href="/service-orders/new">
            <Button>
              <Plus className="h-3.5 w-3.5" />
              {tSO('new')}
            </Button>
          </Link>
        )}
      </header>

      {/* Filtros */}
      <section className="grid grid-cols-1 gap-3 rounded-md border border-border bg-surface p-4 md:grid-cols-5">
        <div className="md:col-span-2">
          <Label htmlFor="so-search">{tCommon('search')}</Label>
          <Input
            id="so-search"
            placeholder={tList('searchPlaceholder')}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div>
          <Label htmlFor="so-status">{tCommon('status')}</Label>
          <Select
            id="so-status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as ServiceOrderDisplayStatus | '');
              setPage(1);
            }}
          >
            <option value="">{tCommon('all')}</option>
            {STATUS_VALUES.map((s) => (
              <option key={s} value={s}>
                {tStatus(s)}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="so-city">{tList('city')}</Label>
          <Input
            id="so-city"
            value={city}
            onChange={(e) => {
              setCity(e.target.value);
              setPage(1);
            }}
            placeholder={tList('cityPlaceholder')}
          />
        </div>
        <div className="grid grid-cols-2 gap-2 md:col-span-1">
          <div>
            <Label htmlFor="so-from">{tList('scheduledFrom')}</Label>
            <Input
              id="so-from"
              type="date"
              value={scheduledFrom}
              onChange={(e) => {
                setScheduledFrom(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <div>
            <Label htmlFor="so-to">{tList('scheduledTo')}</Label>
            <Input
              id="so-to"
              type="date"
              value={scheduledTo}
              onChange={(e) => {
                setScheduledTo(e.target.value);
                setPage(1);
              }}
            />
          </div>
        </div>
        <div className="flex items-end justify-end md:col-span-5">
          <Button type="button" variant="ghost" onClick={clearFilters}>
            {tCommon('clear')}
          </Button>
        </div>
      </section>

      {/* Lista */}
      <div className="overflow-x-auto rounded-md border border-border bg-surface">
        <table className="min-w-full text-sm">
          <thead className="bg-surface-muted text-left text-[11px] font-semibold uppercase tracking-wider text-text-muted">
            <tr>
              <th className="px-3 py-2">{tList('cols.code')}</th>
              <th className="px-3 py-2">{tList('cols.reason')}</th>
              <th className="px-3 py-2">{tList('cols.customer')}</th>
              <th className="px-3 py-2">{tList('cols.city')}</th>
              <th className="px-3 py-2">{tList('cols.scheduledAt')}</th>
              <th className="px-3 py-2">{tCommon('status')}</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-text-muted">
                  {tList('empty')}
                </td>
              </tr>
            ) : (
              rows.map((o) => (
                <tr
                  key={o.id}
                  className="cursor-pointer hover:bg-surface-hover"
                  onClick={() => {
                    window.location.href = `/service-orders/${o.id}`;
                  }}
                >
                  <td className="px-3 py-2 font-medium text-text">
                    {o.code ?? `#${o.id.slice(0, 8)}`}
                  </td>
                  <td className="px-3 py-2 text-text-muted">
                    {o.reason?.name ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-text-muted">
                    {o.customer?.displayName ?? '—'}
                    {o.contract?.code && (
                      <div className="text-2xs text-text-subtle">
                        {o.contract.code}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-text-muted">
                    {o.city ?? '—'}
                    {o.state && (
                      <span className="text-2xs text-text-subtle"> · {o.state}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-text-muted">
                    {o.scheduledAt ? formatDate(o.scheduledAt) : '—'}
                  </td>
                  <td className="px-3 py-2">
                    <ServiceOrderStatusBadge status={o.displayStatus} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Link
                      href={`/service-orders/${o.id}`}
                      className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-300"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {tCommon('open')} →
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {data && data.pagination.totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-text-muted">
          <span>
            {tCommon('page')} {data.pagination.page} {tCommon('of')}{' '}
            {data.pagination.totalPages}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              {tCommon('previous')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= data.pagination.totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              {tCommon('next')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
