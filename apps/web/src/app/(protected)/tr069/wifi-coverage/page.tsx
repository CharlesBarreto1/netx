'use client';

/**
 * /tr069/wifi-coverage — ranking de ONTs com pior cobertura Wi-Fi.
 *
 * Agrega o RSSI médio dos clientes Wi-Fi por CPE na janela escolhida e lista
 * do pior pro melhor. Serve pra atendimento PROATIVO (ligar antes do cliente
 * reclamar) e pra prospecção de MESH/repetidor. Cada linha linka pro cliente
 * e pro detalhe técnico do device.
 */
import { Wifi } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';
import useSWR from 'swr';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import { tr069Api } from '@/lib/provisioning-api';

const PAGE_SIZE = 50;

/** Cor do RSSI: ≥-65 bom, -65..-75 atenção, <-75 ruim. */
function rssiTone(rssi: number | null): 'success' | 'warning' | 'danger' | 'neutral' {
  if (rssi === null) return 'neutral';
  if (rssi >= -65) return 'success';
  if (rssi >= -75) return 'warning';
  return 'danger';
}

export default function Tr069WifiCoveragePage() {
  const t = useTranslations('tr069');
  const [days, setDays] = useState(7);
  const [maxRssi, setMaxRssi] = useState(-70);
  const [page, setPage] = useState(1);

  const { data, isLoading, error } = useSWR(
    ['tr069/wifi-coverage', days, maxRssi, page],
    () => tr069Api.wifiCoverage({ days, maxRssi, page, pageSize: PAGE_SIZE }),
    { refreshInterval: 60_000, keepPreviousData: true },
  );

  const rows = data?.data ?? [];
  const totalPages = data?.pagination.totalPages ?? 1;
  const total = data?.pagination.total ?? 0;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Wifi className="h-6 w-6 text-sky-500" /> {t('coverage.title')}
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">{t('coverage.subtitle')}</p>
      </header>

      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-slate-500">{t('coverage.window')}</span>
          <Select
            value={String(days)}
            onChange={(e) => {
              setDays(Number(e.target.value));
              setPage(1);
            }}
          >
            <option value="1">{t('coverage.days1')}</option>
            <option value="7">{t('coverage.days7')}</option>
            <option value="30">{t('coverage.days30')}</option>
          </Select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-slate-500">{t('coverage.threshold')}</span>
          <Select
            value={String(maxRssi)}
            onChange={(e) => {
              setMaxRssi(Number(e.target.value));
              setPage(1);
            }}
          >
            <option value="-65">≤ -65 dBm</option>
            <option value="-70">≤ -70 dBm</option>
            <option value="-75">≤ -75 dBm</option>
          </Select>
        </label>
        <span className="pb-2 text-xs text-slate-500">{t('coverage.count', { n: total })}</span>
      </div>

      {isLoading && !data ? (
        <PageLoader />
      ) : error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {t('coverage.loadError')}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-10 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
          {t('coverage.empty')}
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">{t('coverage.colCustomer')}</th>
                  <th className="px-3 py-2 text-left font-medium">{t('coverage.colSn')}</th>
                  <th className="px-3 py-2 text-right font-medium">{t('coverage.colAvg')}</th>
                  <th className="px-3 py-2 text-right font-medium">{t('coverage.colWorst')}</th>
                  <th className="px-3 py-2 text-right font-medium">{t('coverage.colSamples')}</th>
                  <th className="px-3 py-2 text-left font-medium">{t('coverage.colLastSeen')}</th>
                  <th className="px-3 py-2 text-right font-medium">{t('coverage.colDetail')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {rows.map((r) => (
                  <tr key={r.deviceId} className="hover:bg-slate-50 dark:hover:bg-slate-900/50">
                    <td className="px-3 py-2">
                      {r.customerId ? (
                        <Link
                          href={`/customers/${r.customerId}`}
                          className="text-sky-600 hover:underline dark:text-sky-400"
                        >
                          {r.customerName ?? '—'}
                        </Link>
                      ) : (
                        (r.customerName ?? '—')
                      )}
                      {r.contractCode && (
                        <span className="ml-2 text-xs text-slate-400">{r.contractCode}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{r.ontSnGpon ?? '—'}</td>
                    <td className="px-3 py-2 text-right">
                      <Badge tone={rssiTone(r.avgRssi)}>{r.avgRssi === null ? '—' : `${r.avgRssi} dBm`}</Badge>
                    </td>
                    <td className="px-3 py-2 text-right text-slate-500">
                      {r.worstRssi === null ? '—' : `${r.worstRssi} dBm`}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-500">{r.samples}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">
                      {r.lastSeenAt ? new Date(r.lastSeenAt).toLocaleString('pt-BR') : '—'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Link
                        href={`/tr069/devices/${r.deviceId}`}
                        className="text-xs text-sky-600 hover:underline dark:text-sky-400"
                      >
                        {t('coverage.colDetail')}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-end gap-2 text-sm">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                {t('coverage.prev')}
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
                {t('coverage.next')}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
