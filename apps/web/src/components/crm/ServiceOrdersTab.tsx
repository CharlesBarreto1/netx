'use client';

import Link from 'next/link';
import { Plus } from 'lucide-react';
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
  IN_PROGRESS: 'warning',
  OVERDUE: 'danger',
  COMPLETED: 'success',
  CANCELLED: 'neutral',
};

const STATUS_LABEL: Record<ServiceOrderDisplayStatus, string> = {
  OPEN: 'Abierta',
  SCHEDULED: 'Agendada',
  IN_PROGRESS: 'En ejecución',
  OVERDUE: 'Atrasada',
  COMPLETED: 'Finalizada',
  CANCELLED: 'Cancelada',
};

export function ServiceOrdersTab({ customerId }: { customerId: string }) {
  const canCreate = hasPermission('service_orders.write');

  const key = serviceOrdersApi.listPath({
    customerId,
    pageSize: 100,
    sortBy: 'openedAt',
    sortDir: 'desc',
  });
  const { data, isLoading, error } = useSWR<Paginated<ServiceOrderResponse>>(key);

  if (isLoading && !data) return <InlineLoader label="Cargando órdenes…" />;
  if (error) {
    return (
      <p className="text-sm text-red-600">Falló al cargar órdenes de servicio.</p>
    );
  }

  const orders = data?.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-text">
            Órdenes de servicio
          </h3>
          <p className="text-xs text-text-muted">
            Todas las O.S de este cliente, en todos sus contratos.
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
              Nueva O.S
            </Button>
          </Link>
        )}
      </div>

      {orders.length === 0 ? (
        <div className="rounded-md border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
          Este cliente aún no tiene órdenes de servicio.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-700">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:bg-slate-900/40 dark:text-slate-400">
              <tr>
                <th className="px-3 py-2">Código</th>
                <th className="px-3 py-2">Motivo</th>
                <th className="px-3 py-2">Apertura</th>
                <th className="px-3 py-2">Agendamiento</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2 text-right">Acciones</th>
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
                      {STATUS_LABEL[o.status]}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Link
                      href={`/service-orders/${o.id}`}
                      className="text-xs text-brand-600 hover:underline dark:text-brand-300"
                    >
                      Abrir →
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
