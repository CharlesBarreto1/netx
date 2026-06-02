'use client';

/**
 * /tr069/devices — listagem básica de dispositivos TR-069.
 *
 * Fase 1: tabela só popula quando o ProvisioningService cria devices
 * placeholder via Tr069TasksService. Inform real só vem na Fase 3 quando
 * apps/cwmp-server existir.
 */
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import useSWR from 'swr';

import { PageLoader } from '@/components/ui/Spinner';
import { tr069Api, type Tr069DeviceRow } from '@/lib/provisioning-api';

export default function Tr069DevicesPage() {
  const t = useTranslations('tr069');
  const { data, isLoading, error } = useSWR<Tr069DeviceRow[]>(
    'tr069/devices',
    () => tr069Api.listDevices(),
    { refreshInterval: 60_000 },
  );

  if (isLoading) return <PageLoader />;
  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
        {t('loadError')}
      </div>
    );
  }
  const rows = data ?? [];

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {t.rich('subtitle', {
            code: (chunks) => <code>{chunks}</code>,
          })}
        </p>
      </header>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-10 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
          {t.rich('empty', {
            code: (chunks) => <code>{chunks}</code>,
          })}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900">
              <tr>
                <th className="px-3 py-2 text-left font-medium">{t('colDeviceId')}</th>
                <th className="px-3 py-2 text-left font-medium">{t('colManufacturer')}</th>
                <th className="px-3 py-2 text-left font-medium">{t('colSnGpon')}</th>
                <th className="px-3 py-2 text-left font-medium">{t('colStatus')}</th>
                <th className="px-3 py-2 text-left font-medium">{t('colLastInform')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('colTasks')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {rows.map((d) => (
                <tr key={d.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/50">
                  <td className="px-3 py-2 font-mono text-xs">
                    <Link
                      href={`/tr069/devices/${d.id}`}
                      className="text-sky-600 hover:underline dark:text-sky-400"
                    >
                      {d.deviceId}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{d.manufacturer ?? '—'}</td>
                  <td className="px-3 py-2 font-mono text-xs">{d.ont?.snGpon ?? '—'}</td>
                  <td className="px-3 py-2">
                    <span className="rounded bg-slate-100 px-2 py-0.5 text-xs dark:bg-slate-800">
                      {d.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500">
                    {d.lastInformAt ? new Date(d.lastInformAt).toLocaleString('pt-BR') : t('waiting')}
                  </td>
                  <td className="px-3 py-2 text-right text-xs">{d._count.tasks}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
