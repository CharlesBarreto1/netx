'use client';

/**
 * /os — lista das O.S designadas ao técnico logado. Mobile-first.
 * Toca no card → abre o detalhe (/os/[id]) onde roda o fluxo de campo.
 */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import useSWR from 'swr';

import { PageLoader } from '@/components/ui/Spinner';
import type { Paginated } from '@/lib/crm-types';
import { getSession } from '@/lib/session';
import {
  serviceOrdersApi,
  type ServiceOrderDisplayStatus,
  type ServiceOrderResponse,
} from '@/lib/service-orders-api';

const STATUS_LABEL: Record<ServiceOrderDisplayStatus, string> = {
  OPEN: 'Aberta',
  SCHEDULED: 'Agendada',
  EN_ROUTE: 'A caminho',
  IN_PROGRESS: 'Em execução',
  OVERDUE: 'Atrasada',
  COMPLETED: 'Concluída',
  CANCELLED: 'Cancelada',
};

const STATUS_CLS: Record<ServiceOrderDisplayStatus, string> = {
  OPEN: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  SCHEDULED: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200',
  EN_ROUTE: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-950 dark:text-cyan-200',
  IN_PROGRESS:
    'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-200',
  OVERDUE: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200',
  COMPLETED:
    'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200',
  CANCELLED: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
};

function StatusPill({ s }: { s: ServiceOrderDisplayStatus }) {
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-2xs font-semibold ${STATUS_CLS[s]}`}
    >
      {STATUS_LABEL[s]}
    </span>
  );
}

function OsCard({ o }: { o: ServiceOrderResponse }) {
  const when = o.scheduledAt
    ? new Date(o.scheduledAt).toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;
  return (
    <Link
      href={`/os/${o.id}`}
      className="block rounded-lg border border-border bg-surface p-3 transition-colors hover:bg-surface-hover active:bg-surface-hover"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-sm font-semibold">{o.code ?? '—'}</span>
        <StatusPill s={o.displayStatus} />
      </div>
      <div className="mt-1 text-sm font-medium">
        {o.customer?.displayName ?? 'Cliente'}
      </div>
      <div className="mt-0.5 text-xs text-text-muted">
        {o.reason?.name ?? '—'}
        {o.city ? ` · ${o.city}` : ''}
        {when ? ` · ${when}` : ''}
      </div>
    </Link>
  );
}

export default function OsListPage() {
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => {
    setUserId(getSession()?.user.id ?? null);
  }, []);

  const key = userId
    ? serviceOrdersApi.listPath({
        assignedToId: userId,
        pageSize: 50,
        sortBy: 'scheduledAt',
        sortDir: 'asc',
      })
    : null;
  const { data, isLoading } = useSWR<Paginated<ServiceOrderResponse>>(key);

  if (!userId || isLoading) return <PageLoader label="Carregando O.S…" />;

  const orders = data?.data ?? [];
  const active = orders.filter(
    (o) => o.status !== 'COMPLETED' && o.status !== 'CANCELLED',
  );
  const done = orders.filter((o) => o.status === 'COMPLETED');

  return (
    <div className="space-y-5">
      <h1 className="text-lg font-bold">Minhas ordens de serviço</h1>

      {active.length === 0 && done.length === 0 && (
        <div className="rounded-md border border-border bg-surface p-4 text-sm text-text-muted">
          Nenhuma O.S designada a você no momento.
        </div>
      )}

      {active.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-2xs font-semibold uppercase tracking-wider text-text-subtle">
            Em aberto ({active.length})
          </h2>
          {active.map((o) => (
            <OsCard key={o.id} o={o} />
          ))}
        </section>
      )}

      {done.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-2xs font-semibold uppercase tracking-wider text-text-subtle">
            Concluídas ({done.length})
          </h2>
          {done.map((o) => (
            <OsCard key={o.id} o={o} />
          ))}
        </section>
      )}
    </div>
  );
}
