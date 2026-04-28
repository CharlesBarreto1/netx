'use client';

import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import useSWR from 'swr';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Modal';
import { InlineLoader } from '@/components/ui/Spinner';
import { ApiError } from '@/lib/api';
import {
  contractInvoicesApi,
  contractsApi,
  type Contract,
  type ContractInvoice,
  type InvoiceStatus,
} from '@/lib/contracts-api';
import type { Paginated } from '@/lib/crm-types';
import { formatDate, formatMoney } from '@/lib/format';
import { hasPermission } from '@/lib/session';

/**
 * FinanceTab — financeiro consolidado do cliente.
 *
 * - Lista todas as faturas (de todos os contratos do cliente) ordenadas por
 *   vencimento desc.
 * - Mostra "cards" no topo com totais: aberto, em atraso e total recebido.
 * - Cada linha tem botões: "Baixar fatura" (abre /invoices/[id]/print numa
 *   nova aba e dispara print → salvar como PDF) e, se OPEN/OVERDUE, "Dar baixa"
 *   (PATCH PAID).
 *
 * Por que não há boleto/PIX aqui ainda: a integração com Asaas (Sprint S8–S10)
 * vai fornecer o PDF do boleto + QR PIX. Até lá, o "Baixar" gera um
 * demonstrativo a partir dos próprios dados, suficiente pra envio ao cliente.
 */
const STATUS_TONE: Record<InvoiceStatus, 'info' | 'success' | 'warning' | 'danger'> = {
  OPEN: 'info',
  PAID: 'success',
  OVERDUE: 'danger',
  CANCELLED: 'warning',
};
const STATUS_LABEL: Record<InvoiceStatus, string> = {
  OPEN: 'Em aberto',
  PAID: 'Paga',
  OVERDUE: 'Em atraso',
  CANCELLED: 'Cancelada',
};

export function FinanceTab({ customerId }: { customerId: string }) {
  const canWrite = hasPermission('contracts.write');

  // Faturas do cliente. O backend aceita customerId direto em ListContractInvoicesQuery.
  const invoicesKey = contractInvoicesApi.listPath({
    customerId,
    pageSize: 200,
    sortBy: 'dueDate',
    sortDir: 'desc',
  });
  const {
    data: invoicesResp,
    isLoading,
    error,
    mutate,
  } = useSWR<Paginated<ContractInvoice>>(invoicesKey);

  // Carrega contratos do cliente em paralelo só para mostrar o "código do contrato"
  // bonitinho na tabela. Pequeno (até 100 contratos), zero custo perceptível.
  const { data: contractsResp } = useSWR<Paginated<Contract>>(
    contractsApi.listPath({ customerId, pageSize: 100 }),
  );
  const contractById = new Map<string, Contract>(
    (contractsResp?.data ?? []).map((c) => [c.id, c]),
  );

  // Estado de "dar baixa"
  const [paying, setPaying] = useState<ContractInvoice | null>(null);
  const [busy, setBusy] = useState(false);

  if (isLoading && !invoicesResp) {
    return <InlineLoader label="Carregando faturas…" />;
  }
  if (error) {
    return (
      <p className="text-sm text-red-600">Falha ao carregar faturas do cliente.</p>
    );
  }

  const invoices = invoicesResp?.data ?? [];

  // Totais
  const open = invoices
    .filter((i) => i.status === 'OPEN')
    .reduce((s, i) => s + i.amount, 0);
  const overdue = invoices
    .filter((i) => i.status === 'OVERDUE')
    .reduce((s, i) => s + i.amount, 0);
  const paidTotal = invoices
    .filter((i) => i.status === 'PAID')
    .reduce((s, i) => s + (i.paidAmount ?? i.amount), 0);

  async function handlePay() {
    if (!paying) return;
    setBusy(true);
    try {
      await contractInvoicesApi.pay(paying.id);
      toast.success('Fatura baixada');
      setPaying(null);
      await mutate();
    } catch (err) {
      const msg = err instanceof ApiError ? err.friendlyMessage : 'Falha ao dar baixa';
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Totais */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <SummaryCard
          label="Em aberto"
          value={formatMoney(open)}
          tone="info"
        />
        <SummaryCard
          label="Em atraso"
          value={formatMoney(overdue)}
          tone={overdue > 0 ? 'danger' : 'neutral'}
        />
        <SummaryCard label="Total recebido" value={formatMoney(paidTotal)} tone="success" />
      </div>

      {invoices.length === 0 ? (
        <div className="rounded-md border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
          Esse cliente ainda não possui faturas geradas.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-700">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:bg-slate-900/40 dark:text-slate-400">
              <tr>
                <th className="px-3 py-2">Vencimento</th>
                <th className="px-3 py-2">Contrato</th>
                <th className="px-3 py-2">Referência</th>
                <th className="px-3 py-2 text-right">Valor</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {invoices.map((inv) => {
                const c = contractById.get(inv.contractId);
                const canPay = inv.status === 'OPEN' || inv.status === 'OVERDUE';
                return (
                  <tr key={inv.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/40">
                    <td className="px-3 py-2">{formatDate(inv.dueDate)}</td>
                    <td className="px-3 py-2">
                      {c ? (
                        <Link
                          href={`/contracts/${c.id}`}
                          className="text-brand-600 hover:underline dark:text-brand-300"
                        >
                          {c.code ?? `#${c.id.slice(0, 8)}`}
                        </Link>
                      ) : (
                        <span className="text-2xs text-slate-500">
                          {inv.contractId.slice(0, 8)}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-200">
                      {inv.reference ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatMoney(inv.amount)}
                      {inv.status === 'PAID' &&
                        inv.paidAmount != null &&
                        inv.paidAmount !== inv.amount && (
                          <div className="text-2xs text-emerald-700">
                            pago: {formatMoney(inv.paidAmount)}
                          </div>
                        )}
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={STATUS_TONE[inv.status]}>{STATUS_LABEL[inv.status]}</Badge>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-2">
                        {canPay && canWrite && (
                          <Button
                            variant="outline"
                            size="xs"
                            onClick={() => setPaying(inv)}
                          >
                            Dar baixa
                          </Button>
                        )}
                        <Link
                          href={`/invoices/${inv.id}/print`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <Button variant="ghost" size="xs">
                            Baixar
                          </Button>
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={paying !== null}
        onClose={() => setPaying(null)}
        onConfirm={handlePay}
        title="Dar baixa na fatura?"
        message={
          paying
            ? `Confirmar pagamento de ${formatMoney(paying.amount)} (vencimento ${formatDate(
                paying.dueDate,
              )}). Se o contrato estava suspenso por inadimplência, será reativado automaticamente.`
            : ''
        }
        confirmLabel="Confirmar baixa"
        loading={busy}
      />
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'info' | 'success' | 'warning' | 'danger' | 'neutral';
}) {
  const toneClass: Record<typeof tone, string> = {
    info: 'border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-200',
    success:
      'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200',
    warning:
      'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200',
    danger:
      'border-red-200 bg-red-50 text-red-900 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200',
    neutral:
      'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-200',
  };
  return (
    <div className={`rounded-lg border p-3 ${toneClass[tone]}`}>
      <div className="text-[11px] font-semibold uppercase tracking-wider opacity-80">
        {label}
      </div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}
