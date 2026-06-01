'use client';

import Link from 'next/link';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import useSWR from 'swr';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { InlineLoader } from '@/components/ui/Spinner';
import {
  serviceOrdersApi,
  type ServiceOrderDisplayStatus,
  type ServiceOrderResponse,
} from '@/lib/service-orders-api';
import type { Paginated } from '@/lib/crm-types';
import { formatDateTime } from '@/lib/format';
import { hasPermission } from '@/lib/session';

/**
 * ServiceOrdersTab — todas as O.S do cliente, em todos os contratos.
 *
 * Hub do cliente: atendente vê histórico técnico completo sem sair da tela.
 * "Nova O.S" abre /service-orders/new já vinculado ao cliente (vai pré-
 * selecionar o contrato se houver só um ativo).
 */
const STATUS_TONE: Record<ServiceOrderDisplayStatus, 'info' | 'success' | 'warning' | 'danger' | 'neutral'> = {
  OPEN: 'info',
  SCHEDULED: 'info',
  EN_ROUTE: 'info',
  IN_PROGRESS: 'warning',
  OVERDUE: 'danger',
  COMPLETED: 'success',
  CANCELLED: 'neutral',
};

export function ServiceOrdersTab({ customerId }: { customerId: string }) {
  const canCreate = hasPermission('service_orders.write');
  const t = useTranslations('crmTabs');
  const tc = useTranslations('common');
  const statusLabel = (s: ServiceOrderDisplayStatus): string =>
    t(`serviceOrders.status.${s}` as 'serviceOrders.status.OPEN');

  const key = serviceOrdersApi.listPath({
    customerId,
    pageSize: 100,
    sortBy: 'openedAt',
    sortDir: 'desc',
  });
  const { data, isLoading, error } = useSWR<Paginated<ServiceOrderResponse>>(key);

  if (isLoading && !data) return <InlineLoader label={t('serviceOrders.loading')} />;
  if (error) {
    return (
      <p className="text-sm text-red-600">{t('serviceOrders.loadError')}</p>
    );
  }

  const orders = data?.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-text">
            {t('serviceOrders.title')}
          </h3>
          <p className="text-xs text-text-muted">
            {t('serviceOrders.subtitle')}
          </p>
        </div>
        {canCreate && (
          <Link
            // Pré-seleciona o cliente. A página /service-orders/new já lê
            // ?customerId= via search params (mesmo padrão de /contracts/new).
            href={`/service-orders/new?customerId=${customerId}`}
          >
            <Button size="sm">
              <Plus className="h-3.5 w-3.5" />
              {t('serviceOrders.new')}
            </Button>
          </Link>
        )}
      </div>

      {orders.length === 0 ? (
        <div className="rounded-md border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
          {t('serviceOrders.empty')}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-700">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:bg-slate-900/40 dark:text-slate-400">
              <tr>
                <th className="px-3 py-2">{tc('code')}</th>
                <th className="px-3 py-2">{t('serviceOrders.reason')}</th>
                <th className="px-3 py-2">{t('serviceOrders.opening')}</th>
                <th className="px-3 py-2">{t('serviceOrders.scheduling')}</th>
                <th className="px-3 py-2">{tc('status')}</th>
                <th className="px-3 py-2 text-right">{tc('actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {orders.map((o) => (
                <tr
                  key={o.id}
                  className="hover:bg-slate-50 dark:hover:bg-slate-900/40"
                >
                  <td className="px-3 py-2 font-medium">
                    {o.code ?? `#${o.id.slice(0, 8)}`}
                  </td>
                  <td className="px-3 py-2 text-text-muted">
                    {o.reason?.name ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-text-muted">
                    {formatDateTime(o.openedAt)}
                  </td>
                  <td className="px-3 py-2 text-text-muted">
                    {o.scheduledAt ? formatDateTime(o.scheduledAt) : '—'}
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={STATUS_TONE[o.status]}>
                      {statusLabel(o.status)}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Link
                      href={`/service-orders/${o.id}`}
                      className="text-xs text-brand-600 hover:underline dark:text-brand-300"
                    >
                      {tc('open')} →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
