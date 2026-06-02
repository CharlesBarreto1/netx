'use client';

/**
 * /tr069/alerts — triagem de alertas de diagnóstico proativo das CPEs.
 *
 * Lista os alertas abertos/resolvidos gerados pelo pipeline TR-069 (sinal
 * óptico fora de faixa, TX anormal, CPE offline). Filtros por status e
 * severidade; cada linha linka pro detalhe do device.
 */
import { TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';
import useSWR from 'swr';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import {
  tr069Api,
  type Tr069AlertSeverity,
  type Tr069AlertStatus,
} from '@/lib/provisioning-api';

const SEVERITY_TONE: Record<Tr069AlertSeverity, 'info' | 'warning' | 'danger'> = {
  INFO: 'info',
  WARNING: 'warning',
  CRITICAL: 'danger',
};

const PAGE_SIZE = 20;

export default function Tr069AlertsPage() {
  const t = useTranslations('tr069');
  const [status, setStatus] = useState<Tr069AlertStatus | ''>('OPEN');
  const [severity, setSeverity] = useState<Tr069AlertSeverity | ''>('');
  const [page, setPage] = useState(1);

  const { data, isLoading, error } = useSWR(
    ['tr069/alerts', status, severity, page],
    () =>
      tr069Api.listAlerts({
        status: status || undefined,
        severity: severity || undefined,
        page,
        pageSize: PAGE_SIZE,
      }),
    { refreshInterval: 30_000, keepPreviousData: true },
  );

  const rows = data?.data ?? [];
  const totalPages = data?.pagination.totalPages ?? 1;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">{t('alerts.title')}</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">{t('alerts.subtitle')}</p>
      </header>

      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-slate-500">{t('alerts.filterStatus')}</span>
          <Select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as Tr069AlertStatus | '');
              setPage(1);
            }}
          >
            <option value="">{t('alerts.all')}</option>
            <option value="OPEN">{t('alerts.open')}</option>
            <option value="RESOLVED">{t('alerts.resolved')}</option>
          </Select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-slate-500">{t('alerts.filterSeverity')}</span>
          <Select
            value={severity}
            onChange={(e) => {
              setSeverity(e.target.value as Tr069AlertSeverity | '');
              setPage(1);
            }}
          >
            <option value="">{t('alerts.all')}</option>
            <option value="CRITICAL">{t('alerts.severities.CRITICAL')}</option>
            <option value="WARNING">{t('alerts.severities.WARNING')}</option>
            <option value="INFO">{t('alerts.severities.INFO')}</option>
          </Select>
        </label>
      </div>

      {isLoading && !data ? (
        <PageLoader />
      ) : error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {t('alerts.loadError')}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-10 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
          {t('alerts.empty')}
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">{t('alerts.colSeverity')}</th>
                  <th className="px-3 py-2 text-left font-medium">{t('alerts.colType')}</th>
                  <th className="px-3 py-2 text-left font-medium">{t('alerts.colMessage')}</th>
                  <th className="px-3 py-2 text-left font-medium">{t('alerts.colDevice')}</th>
                  <th className="px-3 py-2 text-left font-medium">{t('alerts.colOpened')}</th>
                  <th className="px-3 py-2 text-left font-medium">{t('alerts.colStatus')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {rows.map((a) => (
                  <tr key={a.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/50">
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-1">
                        {a.severity === 'CRITICAL' && <TriangleAlert className="h-3.5 w-3.5 text-red-500" />}
                        <Badge tone={SEVERITY_TONE[a.severity]}>
                          {t(`alerts.severities.${a.severity}` as 'alerts.severities.INFO')}
                        </Badge>
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {t(`alerts.types.${a.type}` as 'alerts.types.OPTICAL_RX_LOW')}
                    </td>
                    <td className="px-3 py-2 text-slate-600 dark:text-slate-300">{a.message}</td>
                    <td className="px-3 py-2">
                      <Link
                        href={`/tr069/devices/${a.deviceId}`}
                        className="font-mono text-xs text-sky-600 hover:underline dark:text-sky-400"
                      >
                        {a.device?.ontSnGpon ?? a.device?.deviceId ?? a.deviceId.slice(0, 8)}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500">
                      {new Date(a.openedAt).toLocaleString('pt-BR')}
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={a.status === 'OPEN' ? 'warning' : 'success'}>
                        {t(`alerts.statuses.${a.status}` as 'alerts.statuses.OPEN')}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-end gap-2 text-sm">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                {t('alerts.prev')}
              </Button>
              <span className="text-slate-500">
                {page} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                {t('alerts.next')}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
