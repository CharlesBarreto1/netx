'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeftRight, Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import useSWR from 'swr';

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
import { PageLoader } from '@/components/ui/Spinner';
import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api';
import {
  cashRegistersApi,
  type CashMovement,
  type CashMovementType,
  type CashRegister,
  type CashRegisterBalance,
} from '@/lib/finance-api';
import type { Paginated } from '@/lib/crm-types';
import { formatDateTime } from '@/lib/format';
import { useFormatMoney } from '@/lib/use-money';
import { hasPermission } from '@/lib/session';

const TYPE_TONE: Record<
  CashMovementType,
  'success' | 'danger' | 'info' | 'warning' | 'neutral'
> = {
  INCOME: 'success',
  OUTCOME: 'danger',
  TRANSFER_IN: 'info',
  TRANSFER_OUT: 'warning',
  ADJUSTMENT: 'neutral',
};

const TYPE_SIGN: Record<CashMovementType, '+' | '-'> = {
  INCOME: '+',
  OUTCOME: '-',
  TRANSFER_IN: '+',
  TRANSFER_OUT: '-',
  ADJUSTMENT: '+',
};

/**
 * /settings/cash-registers/[id] — extrato + saldo + transferências.
 */
export default function CashRegisterDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const tCR = useTranslations('cashRegisters');
  const tType = useTranslations('cashRegisters.movementType');
  const tCommon = useTranslations('common');
  const formatMoney = useFormatMoney();
  const canWrite = hasPermission('finance.charges.write');

  const detailKey = id ? cashRegistersApi.getPath(id) : null;
  const balanceKey = id ? cashRegistersApi.balancePath(id) : null;

  const [page, setPage] = useState(1);
  const movementsKey = id
    ? cashRegistersApi.movementsPath(id, { page, pageSize: 50 })
    : null;

  const { data: detail } = useSWR<CashRegister>(detailKey);
  const { data: balance, mutate: mutateBalance } = useSWR<CashRegisterBalance>(
    balanceKey,
  );
  const { data: movs, mutate: mutateMovs } = useSWR<Paginated<CashMovement>>(
    movementsKey,
  );

  const [transferOpen, setTransferOpen] = useState(false);
  const [movementOpen, setMovementOpen] = useState(false);

  if (!detail || !balance || !movs) return <PageLoader label={tCommon('loading')} />;

  async function refresh() {
    await Promise.all([mutateBalance(), mutateMovs()]);
  }

  return (
    <div className="space-y-5">
      <header>
        <nav className="text-xs text-text-muted">
          <Link href="/settings/cash-registers" className="hover:underline">
            {tCR('title')}
          </Link>{' '}
          › {detail.name}
        </nav>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{detail.name}</h1>
            <p className="text-xs text-text-muted">
              {detail.currency} ·{' '}
              {detail.isActive ? tCR('fields.isActive') : 'Inativo'}
            </p>
          </div>
          {canWrite && (
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setMovementOpen(true)}>
                <Plus className="h-3.5 w-3.5" />
                Sangria / Ajuste
              </Button>
              <Button onClick={() => setTransferOpen(true)}>
                <ArrowLeftRight className="h-3.5 w-3.5" />
                {tCR('transfer.cta')}
              </Button>
            </div>
          )}
        </div>
      </header>

      {/* Cards de saldo */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card label={tCR('balance.opening')} value={formatMoney(balance.openingBalance)} />
        <Card
          label={tCR('balance.income')}
          value={formatMoney(balance.byType.income + balance.byType.transferIn)}
          tone="success"
        />
        <Card
          label={tCR('balance.outcome')}
          value={formatMoney(
            balance.byType.outcome + balance.byType.transferOut,
          )}
          tone="danger"
        />
        <Card
          label={tCR('balance.current')}
          value={formatMoney(balance.currentBalance)}
          tone="brand"
        />
      </section>

      {/* Extrato */}
      <div className="overflow-x-auto rounded-md border border-border bg-surface">
        <table className="min-w-full text-sm">
          <thead className="bg-surface-muted text-left text-[11px] font-semibold uppercase tracking-wider text-text-muted">
            <tr>
              <th className="px-3 py-2">{tCR('movement.when')}</th>
              <th className="px-3 py-2">{tCR('movement.type')}</th>
              <th className="px-3 py-2">{tCR('movement.description')}</th>
              <th className="px-3 py-2 text-right">{tCR('movement.amount')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {movs.data.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-text-muted">
                  {tCommon('nothingHere')}
                </td>
              </tr>
            ) : (
              movs.data.map((m) => (
                <tr key={m.id}>
                  <td className="px-3 py-2 text-text-muted">
                    {formatDateTime(m.occurredAt)}
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={TYPE_TONE[m.type]}>{tType(m.type)}</Badge>
                  </td>
                  <td className="px-3 py-2 text-text-muted">
                    {m.description ?? '—'}
                    {m.counterpart && (
                      <div className="text-2xs text-text-subtle">
                        {m.type === 'TRANSFER_OUT' ? '→ ' : '← '}
                        {m.counterpart.cashRegisterName}
                      </div>
                    )}
                  </td>
                  <td
                    className={
                      'px-3 py-2 text-right tabular-nums font-medium ' +
                      (TYPE_SIGN[m.type] === '+'
                        ? 'text-emerald-700 dark:text-emerald-300'
                        : 'text-red-700 dark:text-red-300')
                    }
                  >
                    {TYPE_SIGN[m.type]}
                    {formatMoney(m.amount)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {movs.pagination.totalPages > 1 && (
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
            {movs.pagination.page} / {movs.pagination.totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= movs.pagination.totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            {tCommon('next')}
          </Button>
        </div>
      )}

      {transferOpen && id && (
        <TransferDialog
          fromId={id}
          fromName={detail.name}
          onClose={async (ok) => {
            setTransferOpen(false);
            if (ok) await refresh();
          }}
        />
      )}

      {movementOpen && id && (
        <ManualMovementDialog
          cashRegisterId={id}
          onClose={async (ok) => {
            setMovementOpen(false);
            if (ok) await refresh();
          }}
        />
      )}
    </div>
  );
}

// =============================================================================
// CARDS
// =============================================================================
function Card({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'success' | 'danger' | 'brand';
}) {
  const cls =
    tone === 'success'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200'
      : tone === 'danger'
        ? 'border-red-200 bg-red-50 text-red-900 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200'
        : tone === 'brand'
          ? 'border-brand-200 bg-brand-50 text-brand-900 dark:border-brand-900/60 dark:bg-brand-950/30 dark:text-brand-200'
          : 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-200';
  return (
    <div className={`rounded-lg border p-3 ${cls}`}>
      <div className="text-[11px] font-semibold uppercase tracking-wider opacity-80">
        {label}
      </div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

// =============================================================================
// TRANSFER DIALOG
// =============================================================================
function TransferDialog({
  fromId,
  fromName,
  onClose,
}: {
  fromId: string;
  fromName: string;
  onClose: (ok: boolean) => void;
}) {
  const tCR = useTranslations('cashRegisters');
  const tCommon = useTranslations('common');
  const { data: registers } = useSWR<CashRegister[]>(cashRegistersApi.listPath());

  const [toId, setToId] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const targets = (registers ?? []).filter((r) => r.id !== fromId && r.isActive);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!toId || !amount) return;
    setSubmitting(true);
    setError(null);
    try {
      await cashRegistersApi.transfer(fromId, {
        toCashRegisterId: toId,
        amount: Number(amount.replace(',', '.')),
        description: description.trim() || undefined,
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
            <DialogTitle>{tCR('transfer.title')}</DialogTitle>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-3">
            <p className="text-xs text-text-muted">
              {tCR('transfer.from')}:{' '}
              <strong className="text-text">{fromName}</strong>
            </p>
            <div>
              <Label required>{tCR('transfer.to')}</Label>
              <Select value={toId} onChange={(e) => setToId(e.target.value)}>
                <option value="">{tCommon('select')}</option>
                {targets.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </Select>
              <FieldHelp>{tCR('transfer.help')}</FieldHelp>
            </div>
            <div>
              <Label required>{tCR('movement.amount')}</Label>
              <Input
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0,00"
              />
            </div>
            <div>
              <Label>{tCR('movement.description')}</Label>
              <Textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
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
            <Button type="submit" loading={submitting} disabled={!toId || !amount}>
              {tCR('transfer.confirm')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// =============================================================================
// MANUAL MOVEMENT DIALOG (sangria / ajuste)
// =============================================================================
function ManualMovementDialog({
  cashRegisterId,
  onClose,
}: {
  cashRegisterId: string;
  onClose: (ok: boolean) => void;
}) {
  const tCR = useTranslations('cashRegisters');
  const tType = useTranslations('cashRegisters.movementType');
  const tCommon = useTranslations('common');

  const [type, setType] = useState<'INCOME' | 'OUTCOME' | 'ADJUSTMENT'>(
    'OUTCOME',
  );
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!amount) return;
    setSubmitting(true);
    setError(null);
    try {
      await cashRegistersApi.createMovement(cashRegisterId, {
        type,
        amount: Number(amount.replace(',', '.')),
        description: description.trim() || undefined,
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
            <DialogTitle>{tCR('movement.manualTitle')}</DialogTitle>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-3">
            <div>
              <Label required>{tCR('movement.type')}</Label>
              <Select
                value={type}
                onChange={(e) =>
                  setType(e.target.value as 'INCOME' | 'OUTCOME' | 'ADJUSTMENT')
                }
              >
                <option value="OUTCOME">{tType('OUTCOME')}</option>
                <option value="INCOME">{tType('INCOME')}</option>
                <option value="ADJUSTMENT">{tType('ADJUSTMENT')}</option>
              </Select>
            </div>
            <div>
              <Label required>{tCR('movement.amount')}</Label>
              <Input
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0,00"
              />
            </div>
            <div>
              <Label>{tCR('movement.description')}</Label>
              <Textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
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
            <Button type="submit" loading={submitting} disabled={!amount}>
              {tCommon('confirm')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
