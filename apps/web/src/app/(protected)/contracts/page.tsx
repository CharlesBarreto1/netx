'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import useSWR from 'swr';

import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import { contractsApi, type Contract, type ContractStatus } from '@/lib/contracts-api';
import type { Paginated } from '@/lib/crm-types';
import { formatDate } from '@/lib/format';
import { useFormatMoney } from '@/lib/use-money';
import { hasPermission } from '@/lib/session';

import { StatusBadge } from './_components/StatusBadge';

/**
 * /contracts — lista simples de contratos com filtros.
 *
 * Escopo do MVP:
 *   - Tabela com cliente, PPPoE, velocidade, mensalidade, vencimento, status.
 *   - Filtro por status + busca textual (código / pppoe / endereço).
 *   - Botão "Novo contrato" (vai para /contracts/new).
 *   - Clique na linha abre o detalhe.
 */
export default function ContractsPage() {
  const canWrite = hasPermission('contracts.write');
  const formatMoney = useFormatMoney();
  const tContracts = useTranslations('contracts');
  const tList = useTranslations('contracts.list');
  const tStatus = useTranslations('contracts.status');
  const tCommon = useTranslations('common');

  const [status, setStatus] = useState<ContractStatus | ''>('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const key = useMemo(
    () => contractsApi.listPath({
      page,
      pageSize,
      status: status || undefined,
      search: search || undefined,
      sortBy: 'createdAt',
      sortDir: 'desc',
    }),
    [page, pageSize, status, search],
  );

  const { data, isLoading } = useSWR<Paginated<Contract>>(key);

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-col">
          <h1 className="text-xl font-semibold tracking-tight text-text">
            {tContracts('title')}
          </h1>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {canWrite && (
            <Link href="/contracts/new">
              <Button size="sm">{tContracts('new')}</Button>
            </Link>
          )}
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder={tList('searchPlaceholder')}
          value={search}
          onChange={(e) => {
            setPage(1);
            setSearch(e.target.value);
          }}
          className="max-w-sm"
        />
        <Select
          value={status}
          onChange={(e) => {
            setPage(1);
            setStatus(e.target.value as ContractStatus | '');
          }}
          className="w-40"
        >
          <option value="">{tList('allStatuses')}</option>
          <option value="PENDING_INSTALL">{tStatus('pendingInstall')}</option>
          <option value="ACTIVE">{tStatus('active')}</option>
          <option value="SUSPENDED">{tStatus('suspended')}</option>
          <option value="CANCELLED">{tStatus('cancelled')}</option>
        </Select>
        <span className="ml-auto text-xs text-text-muted">
          {data?.pagination ? `${data.pagination.total} ${tList('countSuffix')}` : ''}
        </span>
      </div>

      {/* Lista */}
      {isLoading && !data ? (
        <PageLoader label={tList('loading')} />
      ) : !data || data.data.length === 0 ? (
        <EmptyState canWrite={canWrite} />
      ) : (
        <div className="overflow-x-auto rounded-md border border-border bg-surface">
          <table className="min-w-full text-sm">
            <thead className="bg-surface-muted text-xs uppercase tracking-wide text-text-muted">
              <tr>
                <th className="px-3 py-2 text-left">{tList('cols.customer')}</th>
                <th className="px-3 py-2 text-left">{tList('cols.pppoe')}</th>
                <th className="px-3 py-2 text-left">{tList('cols.bandwidth')}</th>
                <th className="px-3 py-2 text-right">{tList('cols.monthly')}</th>
                <th className="px-3 py-2 text-center">{tList('cols.dueDay')}</th>
                <th className="px-3 py-2 text-left">{tList('cols.status')}</th>
                <th className="px-3 py-2 text-left">{tList('cols.createdAt')}</th>
              </tr>
            </thead>
            <tbody>
              {data.data.map((c) => (
                <tr
                  key={c.id}
                  className="cursor-pointer border-t border-border hover:bg-surface-hover"
                  onClick={() => {
                    window.location.href = `/contracts/${c.id}`;
                  }}
                >
                  <td className="px-3 py-2">
                    <div className="font-medium text-text">{c.customer?.displayName ?? '—'}</div>
                    {c.code && <div className="text-xs text-text-muted">{c.code}</div>}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {c.authMethod === 'IPOE'
                      ? c.circuitId ?? c.macAddress ?? '—'
                      : c.pppoeUsername ?? '—'}
                    <span className="ml-1 text-[10px] uppercase text-text-muted">
                      {c.authMethod === 'IPOE' ? 'ipoe' : 'pppoe'}
                    </span>
                  </td>
                  <td className="px-3 py-2">{c.bandwidthMbps} Mbps</td>
                  <td className="px-3 py-2 text-right">{formatMoney(c.monthlyValue)}</td>
                  <td className="px-3 py-2 text-center">dia {c.dueDay}</td>
                  <td className="px-3 py-2">
                    <StatusBadge status={c.status} />
                  </td>
                  <td className="px-3 py-2 text-xs text-text-muted">{formatDate(c.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Paginação */}
      {data && data.pagination && data.pagination.totalPages > 1 && (
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

function EmptyState({ canWrite }: { canWrite: boolean }) {
  const tList = useTranslations('contracts.list');
  return (
    <div className="flex flex-col items-center gap-3 rounded-md border border-dashed border-border bg-surface px-6 py-12 text-center">
      <p className="text-sm font-medium text-text">{tList('empty')}</p>
      <p className="max-w-md text-xs text-text-muted">{tList('emptyHelp')}</p>
      {canWrite && (
        <Link href="/contracts/new">
          <Button size="sm">{tList('createCta')}</Button>
        </Link>
      )}
    </div>
  );
}
