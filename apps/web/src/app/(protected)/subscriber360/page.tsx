'use client';

/**
 * Assinante 360 (console do atendente) — busca um cliente e mostra o agregado
 * read-only vindo do BFF (ERP + CPE + rede óptica + RADIUS numa chamada). É a
 * tela transversal/diferencial. Ações contextuais chamam a API do módulo dono.
 */
import { useState } from 'react';
import useSWR from 'swr';

import { ApiError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { hasPermission } from '@/lib/session';
import { useFormatMoney } from '@/lib/use-money';
import {
  getSubscriber360,
  searchCustomers,
  subscriber360Path,
  type CustomerSearchItem,
  type S360Contract,
  type Subscriber360,
} from '@/lib/subscriber360-api';

export default function Subscriber360Page() {
  const canRead = hasPermission('field.subscriber360.read');
  const fmt = useFormatMoney();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CustomerSearchItem[]>([]);
  const [selected, setSelected] = useState<CustomerSearchItem | null>(null);
  const [searching, setSearching] = useState(false);

  const { data, isLoading, error } = useSWR<Subscriber360>(
    canRead && selected ? subscriber360Path(selected.id) : null,
    () => getSubscriber360(selected!.id),
    { revalidateOnFocus: false },
  );

  async function runSearch(q: string) {
    setQuery(q);
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    try {
      setResults(await searchCustomers(q));
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }

  if (!canRead) {
    return <div className="text-sm text-text-muted">Sem acesso ao Assinante 360.</div>;
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-text">Assinante 360</h1>
        <p className="text-sm text-text-muted">
          Busque um cliente para ver contrato, financeiro, CPE e conexão numa tela só.
        </p>
      </header>

      {/* Busca */}
      <div className="relative max-w-xl">
        <input
          value={query}
          onChange={(e) => void runSearch(e.target.value)}
          placeholder="Nome, código ou telefone do cliente…"
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-primary"
        />
        {results.length > 0 && !selected && (
          <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-border bg-surface shadow-lg">
            {results.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => {
                    setSelected(c);
                    setResults([]);
                    setQuery(c.displayName);
                  }}
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-border/40"
                >
                  <span className="text-text">{c.displayName}</span>
                  <span className="text-xs text-text-muted">{c.code ?? c.primaryPhone ?? ''}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {searching && <p className="mt-1 text-xs text-text-muted">Buscando…</p>}
      </div>

      {selected && (
        <div>
          {isLoading && <p className="text-sm text-text-muted">Carregando 360…</p>}
          {error && (
            <p className="text-sm text-danger">
              {error instanceof ApiError ? error.friendlyMessage : 'Falha ao carregar.'}
            </p>
          )}
          {data && <Subscriber360View data={data} fmt={fmt} />}
        </div>
      )}
    </div>
  );
}

function Subscriber360View({
  data,
  fmt,
}: {
  data: Subscriber360;
  fmt: ReturnType<typeof useFormatMoney>;
}) {
  return (
    <div className="space-y-5">
      {/* Cabeçalho do cliente */}
      <section className="rounded-xl border border-border bg-surface p-4">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-text">{data.customer.displayName}</h2>
            <p className="text-sm text-text-muted">
              {data.customer.code ?? '—'} · {data.customer.status}
            </p>
            <p className="text-sm text-text-muted">
              {data.customer.primaryPhone ?? ''} {data.customer.primaryEmail ?? ''}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-text-muted">Em aberto</p>
            <p className={`text-lg font-semibold ${data.balanceDue > 0 ? 'text-danger' : 'text-text'}`}>
              {fmt(data.balanceDue)}
            </p>
          </div>
        </div>
      </section>

      {/* Contratos */}
      <section className="space-y-3">
        <h3 className="text-sm font-medium text-text-muted">Contratos</h3>
        {data.contracts.map((c) => (
          <ContractCard key={c.id} c={c} fmt={fmt} />
        ))}
        {data.contracts.length === 0 && (
          <p className="text-sm text-text-muted">Nenhum contrato.</p>
        )}
      </section>

      {/* Faturas em aberto */}
      {data.openInvoices.length > 0 && (
        <section className="rounded-xl border border-border bg-surface p-4">
          <h3 className="mb-2 text-sm font-medium text-text-muted">Faturas em aberto</h3>
          <ul className="divide-y divide-border text-sm">
            {data.openInvoices.map((i) => (
              <li key={i.id} className="flex items-center justify-between py-2">
                <span className={i.status === 'OVERDUE' ? 'text-danger' : 'text-text'}>
                  Vence {formatDate(i.dueDate)} {i.status === 'OVERDUE' ? '(vencida)' : ''}
                </span>
                <span className="text-text">{fmt(i.amount)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* O.S recentes */}
      {data.recentServiceOrders.length > 0 && (
        <section className="rounded-xl border border-border bg-surface p-4">
          <h3 className="mb-2 text-sm font-medium text-text-muted">O.S recentes</h3>
          <ul className="divide-y divide-border text-sm">
            {data.recentServiceOrders.map((o) => (
              <li key={o.id} className="flex items-center justify-between py-2">
                <span className="text-text">
                  {o.code ?? '—'} · {o.reasonName}
                </span>
                <span className="text-text-muted">{o.displayStatus}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-xs text-text-muted">
        Snapshot: {new Date(data.generatedAt).toLocaleString('pt-BR')}
      </p>
    </div>
  );
}

function ContractCard({ c, fmt }: { c: S360Contract; fmt: ReturnType<typeof useFormatMoney> }) {
  const online = c.connection.online;
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium text-text">
            {c.code ?? '—'} · {c.planName ?? `${c.bandwidthMbps} Mbps`}
          </p>
          <p className="text-sm text-text-muted">{c.installationAddress}</p>
        </div>
        <div className="text-right">
          <span
            className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${
              c.status === 'ACTIVE'
                ? online
                  ? 'bg-green-500/15 text-green-500'
                  : 'bg-amber-500/15 text-amber-500'
                : 'bg-border/50 text-text-muted'
            }`}
          >
            {c.status}
            {c.status === 'ACTIVE' ? (online ? ' · online' : ' · offline') : ''}
          </span>
          <p className="mt-1 text-sm text-text">{fmt(c.monthlyValue)}/mês</p>
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs text-text-muted sm:grid-cols-4">
        <div>
          <dt>PPPoE</dt>
          <dd className="text-text">{c.pppoeUsername ?? '—'}</dd>
        </div>
        <div>
          <dt>ONT / SN</dt>
          <dd className="text-text">{c.ont?.snGpon ?? '—'}</dd>
        </div>
        <div>
          <dt>Sinal Rx (dBm)</dt>
          <dd className="text-text">{c.ont?.lastRxPowerDbm ?? '—'}</dd>
        </div>
        <div>
          <dt>CTO / porta</dt>
          <dd className="text-text">
            {c.opticalPort ? `${c.opticalPort.enclosureCode}/${c.opticalPort.number}` : '—'}
          </dd>
        </div>
      </dl>
    </div>
  );
}
