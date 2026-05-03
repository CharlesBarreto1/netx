'use client';

import Link from 'next/link';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import useSWR from 'swr';

import { PaymentDialog } from '@/components/finance/PaymentDialog';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FieldHelp, Input, Label, Select, Textarea } from '@/components/ui/Input';
import { ConfirmDialog } from '@/components/ui/Modal';
import { PageLoader } from '@/components/ui/Spinner';
import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api';
import {
  chargesApi,
  type OneTimeCharge,
  type OneTimeChargeStatus,
} from '@/lib/finance-api';
import type { Customer, Paginated } from '@/lib/crm-types';
import { formatDate, formatDateTime } from '@/lib/format';
import { useFormatMoney } from '@/lib/use-money';
import { hasPermission } from '@/lib/session';

const STATUS_TONE: Record<OneTimeChargeStatus, 'info' | 'success' | 'warning'> = {
  OPEN: 'info',
  PAID: 'success',
  CANCELLED: 'warning',
};

/**
 * /finance/charges — cobranças avulsas (não-recorrentes).
 * Filtros: customer, status, dueDate range, search.
 */
export default function ChargesListPage() {
  const tCharges = useTranslations('charges');
  const tStatus = useTranslations('charges.statusLabel');
  const tCommon = useTranslations('common');
  const formatMoney = useFormatMoney();
  const canCreate = hasPermission('finance.charges.write');

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<OneTimeChargeStatus | ''>('');
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const key = chargesApi.listPath({
    page,
    pageSize,
    search: search || undefined,
    status: status || undefined,
  });
  const { data, isLoading, mutate } = useSWR<Paginated<OneTimeCharge>>(key);

  const [creating, setCreating] = useState(false);
  const [paying, setPaying] = useState<OneTimeCharge | null>(null);
  const [cancelling, setCancelling] = useState<OneTimeCharge | null>(null);

  if (isLoading && !data) return <PageLoader label={tCommon('loading')} />;

  const rows = data?.data ?? [];

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{tCharges('title')}</h1>
          <p className="text-sm text-text-muted">{tCharges('subtitle')}</p>
        </div>
        {canCreate && (
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5" />
            {tCharges('new')}
          </Button>
        )}
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder={tCommon('search')}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          className="max-w-sm"
        />
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as OneTimeChargeStatus | '');
            setPage(1);
          }}
          className="w-40"
        >
          <option value="">{tCommon('all')}</option>
          <option value="OPEN">{tStatus('OPEN')}</option>
          <option value="PAID">{tStatus('PAID')}</option>
          <option value="CANCELLED">{tStatus('CANCELLED')}</option>
        </Select>
      </div>

      <div className="overflow-x-auto rounded-md border border-border bg-surface">
        <table className="min-w-full text-sm">
          <thead className="bg-surface-muted text-left text-[11px] font-semibold uppercase tracking-wider text-text-muted">
            <tr>
              <th className="px-3 py-2">{tCommon('code')}</th>
              <th className="px-3 py-2">{tCharges('fields.customer')}</th>
              <th className="px-3 py-2">{tCharges('fields.description')}</th>
              <th className="px-3 py-2 text-right">{tCharges('fields.amount')}</th>
              <th className="px-3 py-2">{tCharges('fields.dueDate')}</th>
              <th className="px-3 py-2">{tCommon('status')}</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-text-muted">
                  {tCommon('nothingHere')}
                </td>
              </tr>
            ) : (
              rows.map((c) => (
                <tr key={c.id} className="hover:bg-surface-hover">
                  <td className="px-3 py-2 font-medium text-text">
                    {c.code ?? `#${c.id.slice(0, 8)}`}
                  </td>
                  <td className="px-3 py-2 text-text-muted">
                    {c.customer ? (
                      <Link
                        href={`/customers/${c.customer.id}`}
                        className="text-brand-500 hover:underline"
                      >
                        {c.customer.displayName}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-3 py-2 text-text-muted">{c.description}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatMoney(c.amount)}
                    {c.discountAmount && c.discountAmount > 0 && (
                      <div className="text-2xs text-text-subtle">
                        -{formatMoney(c.discountAmount)}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-text-muted">
                    {formatDate(c.dueDate)}
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={STATUS_TONE[c.status]}>{tStatus(c.status)}</Badge>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {c.status === 'OPEN' && canCreate && (
                      <div className="flex justify-end gap-1">
                        <Button size="sm" onClick={() => setPaying(c)}>
                          {tCharges('actions.pay')}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setCancelling(c)}
                        >
                          {tCommon('cancel')}
                        </Button>
                      </div>
                    )}
                    {c.status === 'PAID' && c.paidAt && (
                      <span className="text-2xs text-text-muted">
                        {formatDateTime(c.paidAt)}
                      </span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {data && data.pagination.totalPages > 1 && (
        <div className="flex items-center justify-end gap-2 text-xs text-text-muted">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            {tCommon('previous')}
          </Button>
          <span>
            {data.pagination.page} / {data.pagination.totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= data.pagination.totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            {tCommon('next')}
          </Button>
        </div>
      )}

      {creating && (
        <NewChargeDialog
          onClose={async (created) => {
            setCreating(false);
            if (created) await mutate();
          }}
        />
      )}

      {paying && (
        <PaymentDialog
          open
          onOpenChange={(v) => !v && setPaying(null)}
          amount={paying.amount}
          description={`${paying.code ?? ''} · ${paying.description}`}
          onConfirm={async (input) => {
            await chargesApi.pay(paying.id, input);
            toast.success(tCommon('success'));
            await mutate();
          }}
        />
      )}

      <ConfirmDialog
        open={!!cancelling}
        onClose={() => setCancelling(null)}
        onConfirm={async () => {
          if (!cancelling) return;
          try {
            await chargesApi.cancel(cancelling.id);
            toast.success(tCommon('success'));
            setCancelling(null);
            await mutate();
          } catch (err) {
            toast.error(err instanceof ApiError ? err.friendlyMessage : 'Erro');
          }
        }}
        title={tCharges('actions.cancel')}
        message="A cobrança ficará marcada como cancelada e não pode ser reaberta."
        confirmLabel={tCommon('confirm')}
        variant="danger"
      />
    </div>
  );
}

// =============================================================================
// NEW CHARGE DIALOG
// =============================================================================
function NewChargeDialog({
  onClose,
}: {
  onClose: (created: boolean) => void;
}) {
  const tCharges = useTranslations('charges');
  const tCommon = useTranslations('common');

  // Lista de clientes — busca incremental.
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const customerKey =
    customerSearch.trim().length >= 2
      ? `/v1/customers?search=${encodeURIComponent(customerSearch.trim())}&pageSize=8`
      : null;
  const { data: hits } = useSWR<Paginated<Customer>>(customerKey);
  const options = hits?.data ?? [];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!customerId || !description.trim() || !amount || !dueDate) {
      setError('Preencha todos os campos obrigatórios.');
      return;
    }
    setSubmitting(true);
    try {
      await chargesApi.create({
        customerId,
        description: description.trim(),
        amount: Number(amount.replace(',', '.')),
        dueDate,
      });
      toast.success(tCommon('success'));
      onClose(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.friendlyMessage : 'Erro');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose(false)}>
      <DialogContent className="max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{tCharges('new')}</DialogTitle>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-3">
            <div>
              <Label required>{tCharges('fields.customer')}</Label>
              <Input
                value={customerSearch}
                onChange={(e) => {
                  setCustomerSearch(e.target.value);
                  setCustomerId(null);
                }}
                placeholder="Buscar por nome…"
              />
              {customerSearch.trim().length >= 2 && (
                <div className="mt-1 max-h-40 overflow-y-auto rounded-md border border-border bg-surface">
                  {options.length === 0 ? (
                    <div className="px-2 py-1.5 text-xs text-text-subtle">
                      Nenhum
                    </div>
                  ) : (
                    options.map((c) => (
                      <button
                        type="button"
                        key={c.id}
                        onClick={() => {
                          setCustomerId(c.id);
                          setCustomerSearch(c.displayName);
                        }}
                        className={
                          'flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left text-xs hover:bg-surface-hover ' +
                          (customerId === c.id ? 'bg-accent-muted text-accent' : '')
                        }
                      >
                        <span className="truncate">{c.displayName}</span>
                        <span className="text-2xs text-text-subtle">
                          {c.primaryEmail ?? c.primaryPhone ?? ''}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            <div>
              <Label required>{tCharges('fields.description')}</Label>
              <Textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Ex.: Taxa de instalação"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label required>{tCharges('fields.amount')}</Label>
                <Input
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0,00"
                />
              </div>
              <div>
                <Label required>{tCharges('fields.dueDate')}</Label>
                <Input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
            </div>
            {error && (
              <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
            )}
          </DialogBody>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onClose(false)}
              disabled={submitting}
            >
              {tCommon('cancel')}
            </Button>
            <Button type="submit" loading={submitting}>
              {tCommon('create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
