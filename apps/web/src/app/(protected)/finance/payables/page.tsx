'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/Button';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { FieldError, Input, Label, Textarea } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api';
import type { Paginated } from '@/lib/crm-types';
import {
  cashRegistersApi,
  payablesApi,
  type CashRegister,
  type ListPayablesParams,
  type PayablesSummary,
  type PaymentMethod,
  type SupplierPayable,
} from '@/lib/finance-api';
import { hasPermission } from '@/lib/session';
import { useFormatMoney } from '@/lib/use-money';

const PAYMENT_METHODS: PaymentMethod[] = [
  'CASH',
  'PIX',
  'CARD',
  'BANK_TRANSFER',
  'BOLETO',
  'OTHER',
];

type StatusFilter = 'ALL' | 'OPEN' | 'OVERDUE' | 'PAID';

export default function PayablesPage() {
  const t = useTranslations('payables');
  const tc = useTranslations('common');
  const fmt = useFormatMoney();
  const canPay = hasPermission('finance.payables.write');
  const canUnpay = hasPermission('cash_registers.manage');

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('OPEN');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [paying, setPaying] = useState<SupplierPayable | null>(null);
  const [reversing, setReversing] = useState<SupplierPayable | null>(null);
  const [busy, setBusy] = useState(false);

  const params: ListPayablesParams = {
    page,
    pageSize: 50,
    ...(statusFilter === 'OVERDUE'
      ? { overdueOnly: true }
      : statusFilter !== 'ALL'
        ? { status: statusFilter }
        : {}),
    ...(search ? { search } : {}),
  };

  const { data, isLoading, error, mutate } = useSWR<Paginated<SupplierPayable>>(
    payablesApi.listPath(params),
    () => payablesApi.list(params),
  );
  const { data: summary, mutate: mutateSummary } = useSWR<PayablesSummary>(
    payablesApi.summaryPath(),
    () => payablesApi.summary(),
  );

  async function refresh() {
    await Promise.all([mutate(), mutateSummary()]);
  }

  async function doUnpay() {
    if (!reversing) return;
    setBusy(true);
    try {
      await payablesApi.unpay(reversing.id);
      toast.success(t('reversedToast'));
      setReversing(null);
      await refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.friendlyMessage : tc('error'));
    } finally {
      setBusy(false);
    }
  }

  const rows = data?.data ?? [];
  const totalPages = data?.pagination
    ? Math.max(1, Math.ceil(data.pagination.total / data.pagination.pageSize))
    : 1;

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('subtitle')}</p>
        </div>
      </header>

      {summary && (
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <SummaryCard
            label={t('summary.open', { count: summary.openCount })}
            value={fmt(summary.openTotal)}
          />
          <SummaryCard
            label={t('summary.overdue', { count: summary.overdueCount })}
            value={fmt(summary.overdueTotal)}
            tone={summary.overdueCount > 0 ? 'danger' : undefined}
          />
          <SummaryCard
            label={t('summary.paidThisMonth')}
            value={fmt(summary.paidThisMonthTotal)}
            tone="success"
          />
        </section>
      )}

      <section className="flex flex-wrap items-end gap-3">
        <div>
          <Label className="text-xs">{t('filters.status')}</Label>
          <select
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as StatusFilter);
              setPage(1);
            }}
          >
            <option value="OPEN">{t('status.OPEN')}</option>
            <option value="OVERDUE">{t('status.OVERDUE')}</option>
            <option value="PAID">{t('status.PAID')}</option>
            <option value="ALL">{t('filters.all')}</option>
          </select>
        </div>
        <div className="grow max-w-sm">
          <Label className="text-xs">{tc('search')}</Label>
          <Input
            value={search}
            placeholder={t('filters.searchPlaceholder')}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
      </section>

      {isLoading && <PageLoader />}
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {t('loadFailed')}
        </div>
      )}

      {data && rows.length === 0 && (
        <p className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
          {t('empty')}
        </p>
      )}

      {rows.length > 0 && (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
              <thead className="bg-slate-50 dark:bg-slate-900/40">
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  <th className="px-4 py-3">{t('th.dueDate')}</th>
                  <th className="px-4 py-3">{t('th.supplier')}</th>
                  <th className="px-4 py-3">{t('th.description')}</th>
                  <th className="px-4 py-3 text-center">{t('th.installment')}</th>
                  <th className="px-4 py-3 text-right">{t('th.amount')}</th>
                  <th className="px-4 py-3">{t('th.status')}</th>
                  <th className="px-4 py-3 text-right">{tc('actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {rows.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/60">
                    <td className="px-4 py-3">
                      {new Date(`${p.dueDate}T00:00:00`).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">{p.supplierName ?? '—'}</td>
                    <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300">
                      {p.description ?? '—'}
                      {p.purchaseInvoiceNumber && (
                        <span className="block font-mono text-slate-400">
                          NF {p.purchaseInvoiceNumber}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {p.installmentNumber}/{p.installmentCount}
                    </td>
                    <td className="px-4 py-3 text-right font-medium">{fmt(p.amount)}</td>
                    <td className="px-4 py-3"><StatusBadge payable={p} /></td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        {p.status === 'OPEN' && canPay && (
                          <Button variant="ghost" size="sm" onClick={() => setPaying(p)}>
                            {t('payAction')}
                          </Button>
                        )}
                        {p.status === 'PAID' && canUnpay && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-600 dark:text-red-400"
                            onClick={() => setReversing(p)}
                          >
                            {t('unpayAction')}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-slate-200 px-4 py-2 text-sm dark:border-slate-700">
              <Button
                variant="ghost"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                {tc('previous')}
              </Button>
              <span className="text-xs text-slate-500">
                {page} / {totalPages}
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage(page + 1)}
              >
                {tc('next')}
              </Button>
            </div>
          )}
        </section>
      )}

      {paying && (
        <PayPayableDialog
          payable={paying}
          onClose={() => setPaying(null)}
          onPaid={async () => {
            setPaying(null);
            await refresh();
          }}
        />
      )}

      <ConfirmDialog
        open={!!reversing}
        onClose={() => setReversing(null)}
        onConfirm={doUnpay}
        title={t('unpayTitle')}
        message={t('unpayMessage')}
        confirmLabel={t('unpayAction')}
        variant="danger"
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
  tone?: 'danger' | 'success';
}) {
  const valueCls =
    tone === 'danger'
      ? 'text-red-600 dark:text-red-400'
      : tone === 'success'
        ? 'text-emerald-600 dark:text-emerald-400'
        : 'text-slate-900 dark:text-slate-100';
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
      <p className={`mt-1 text-xl font-bold ${valueCls}`}>{value}</p>
    </div>
  );
}

function StatusBadge({ payable }: { payable: SupplierPayable }) {
  const t = useTranslations('payables');
  if (payable.status === 'PAID') {
    return (
      <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
        {t('status.PAID')}
      </span>
    );
  }
  if (payable.status === 'CANCELLED') {
    return (
      <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300">
        {t('status.CANCELLED')}
      </span>
    );
  }
  if (payable.isOverdue) {
    return (
      <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/40 dark:text-red-300">
        {t('status.OVERDUE')}
      </span>
    );
  }
  return (
    <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
      {t('status.OPEN')}
    </span>
  );
}

// =============================================================================
// PAY — baixa de parcela (método + caixa opcional + data + observação)
// =============================================================================
function PayPayableDialog({
  payable,
  onClose,
  onPaid,
}: {
  payable: SupplierPayable;
  onClose: () => void;
  onPaid: () => void;
}) {
  const t = useTranslations('payables');
  const tc = useTranslations('common');
  const tpm = useTranslations('finance.paymentMethod');
  const fmt = useFormatMoney();

  // Caixas podem falhar (403) pra quem não gerencia finance — baixa "sem caixa".
  const { data: cashRegisters } = useSWR<CashRegister[]>(
    cashRegistersApi.listPath(),
    () => cashRegistersApi.list(),
    { shouldRetryOnError: false },
  );

  const [cashRegisterId, setCashRegisterId] = useState('');
  const [paidVia, setPaidVia] = useState('');
  const [paidAmount, setPaidAmount] = useState(payable.amount);
  const [paidAt, setPaidAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!Number.isFinite(paidAmount) || paidAmount <= 0) {
      return setError(t('pay.invalidAmount'));
    }
    setSubmitting(true);
    try {
      await payablesApi.pay(payable.id, {
        cashRegisterId: cashRegisterId || null,
        ...(paidVia ? { paidVia: paidVia as PaymentMethod } : {}),
        paidAmount,
        paidAt: new Date(`${paidAt}T12:00:00`).toISOString(),
        ...(note ? { note } : {}),
      });
      toast.success(t('paidToast'));
      onPaid();
    } catch (err) {
      setError(err instanceof ApiError ? err.friendlyMessage : tc('error'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={t('pay.title')}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="rounded-md bg-slate-50 p-3 text-sm dark:bg-slate-900/40">
          <p className="font-medium">{payable.supplierName ?? '—'}</p>
          <p className="text-xs text-slate-500">
            {payable.description ?? '—'} · {payable.installmentNumber}/
            {payable.installmentCount} ·{' '}
            {new Date(`${payable.dueDate}T00:00:00`).toLocaleDateString()} ·{' '}
            <strong>{fmt(payable.amount)}</strong>
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label>{t('pay.amount')}</Label>
            <Input
              type="number"
              step="0.01"
              min="0.01"
              value={paidAmount}
              onChange={(e) => setPaidAmount(Number(e.target.value))}
            />
          </div>
          <div>
            <Label>{t('pay.paidAt')}</Label>
            <Input
              type="date"
              value={paidAt}
              onChange={(e) => setPaidAt(e.target.value)}
            />
          </div>
          <div>
            <Label>{t('pay.method')}</Label>
            <select
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
              value={paidVia}
              onChange={(e) => setPaidVia(e.target.value)}
            >
              <option value="">—</option>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>{tpm(m as 'CASH')}</option>
              ))}
            </select>
          </div>
          <div>
            <Label>{t('pay.cashRegister')}</Label>
            <select
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
              value={cashRegisterId}
              onChange={(e) => setCashRegisterId(e.target.value)}
            >
              <option value="">{t('pay.noCashRegister')}</option>
              {cashRegisters?.filter((r) => r.isActive).map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-500">{t('pay.cashRegisterHelp')}</p>
          </div>
        </div>

        <div>
          <Label>{t('pay.note')}</Label>
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>

        {error && <FieldError>{error}</FieldError>}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
            {tc('cancel')}
          </Button>
          <Button type="submit" loading={submitting}>
            {t('pay.confirm')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
