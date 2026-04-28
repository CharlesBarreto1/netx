'use client';

import Link from 'next/link';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import useSWR from 'swr';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { InlineLoader } from '@/components/ui/Spinner';
import { contractsApi, type Contract } from '@/lib/contracts-api';
import type { Paginated } from '@/lib/crm-types';
import { formatDate } from '@/lib/format';
import { useFormatMoney } from '@/lib/use-money';
import { hasPermission } from '@/lib/session';

/**
 * ContractsTab — lista os contratos vinculados ao cliente atual.
 *
 * Reaproveita o endpoint `GET /v1/contracts?customerId=...` (já filtrado e
 * ordenado pelo backend). Mostra resumo por linha + link para o detalhe; criar
 * contrato leva pra `/contracts/new?customerId=...` (já é suportado pela página).
 */
const STATUS_TONE: Record<Contract['status'], 'success' | 'warning' | 'danger'> = {
  ACTIVE: 'success',
  SUSPENDED: 'warning',
  CANCELLED: 'danger',
};
export function ContractsTab({ customerId }: { customerId: string }) {
  const canWrite = hasPermission('contracts.write');
  const formatMoney = useFormatMoney();
  const tContracts = useTranslations('contracts');
  const statusLabel = (s: Contract['status']) =>
    tContracts(`status.${s.toLowerCase()}` as 'status.active');

  const key = contractsApi.listPath({
    customerId,
    pageSize: 100,
    sortBy: 'createdAt',
    sortDir: 'desc',
  });
  const { data, isLoading, error } = useSWR<Paginated<Contract>>(key);

  if (isLoading && !data) return <InlineLoader label="Carregando contratos…" />;
  if (error) {
    return (
      <p className="text-sm text-red-600">Falha ao carregar contratos do cliente.</p>
    );
  }

  const contracts = data?.data ?? [];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {contracts.length} contrato{contracts.length === 1 ? '' : 's'} vinculado
          {contracts.length === 1 ? '' : 's'} a este cliente.
        </p>
        {canWrite && (
          <Link href={`/contracts/new?customerId=${customerId}`}>
            <Button variant="primary" size="sm">
              <Plus className="h-3.5 w-3.5" />
              Novo contrato
            </Button>
          </Link>
        )}
      </div>

      {contracts.length === 0 ? (
        <EmptyState customerId={customerId} canWrite={canWrite} />
      ) : (
        <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-700">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:bg-slate-900/40 dark:text-slate-400">
              <tr>
                <th className="px-3 py-2">Contrato</th>
                <th className="px-3 py-2">Plano</th>
                <th className="px-3 py-2">Mensalidade</th>
                <th className="px-3 py-2">Vencimento</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Criado</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {contracts.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/40">
                  <td className="px-3 py-2">
                    <div className="font-medium text-slate-800 dark:text-slate-100">
                      {c.code ?? `#${c.id.slice(0, 8)}`}
                    </div>
                    <div className="font-mono text-2xs text-slate-500">
                      {c.pppoeUsername}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-slate-700 dark:text-slate-200">
                    {c.bandwidthMbps} Mbps
                  </td>
                  <td className="px-3 py-2 tabular-nums text-slate-700 dark:text-slate-200">
                    {formatMoney(c.monthlyValue)}
                  </td>
                  <td className="px-3 py-2 text-slate-700 dark:text-slate-200">
                    dia {c.dueDay}
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={STATUS_TONE[c.status]}>{statusLabel(c.status)}</Badge>
                  </td>
                  <td className="px-3 py-2 text-slate-500">{formatDate(c.createdAt)}</td>
                  <td className="px-3 py-2 text-right">
                    <Link
                      href={`/contracts/${c.id}`}
                      className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-300"
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

function EmptyState({
  customerId,
  canWrite,
}: {
  customerId: string;
  canWrite: boolean;
}) {
  return (
    <div className="rounded-md border border-dashed border-slate-300 p-6 text-center dark:border-slate-700">
      <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
        Esse cliente ainda não tem contrato.
      </p>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
        Crie o primeiro contrato pra começar a faturar e provisionar o RADIUS.
      </p>
      {canWrite && (
        <Link
          href={`/contracts/new?customerId=${customerId}`}
          className="mt-3 inline-block text-sm font-medium text-brand-600 hover:underline dark:text-brand-300"
        >
          + Novo contrato
        </Link>
      )}
    </div>
  );
}
