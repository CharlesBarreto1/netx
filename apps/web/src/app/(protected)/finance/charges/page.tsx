'use client';

import Link from 'next/link';
import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import useSWR from 'swr';

import { NewChargeDialog } from '@/components/finance/NewChargeDialog';
import { PaymentDialog } from '@/components/finance/PaymentDialog';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { ConfirmDialog } from '@/components/ui/Modal';
import { PageLoader } from '@/components/ui/Spinner';
import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api';
import {
  contractInvoicesApi,
  type ContractInvoice,
  type InvoiceStatus,
} from '@/lib/contracts-api';
import {
  chargesApi,
  type OneTimeCharge,
  type OneTimeChargeStatus,
} from '@/lib/finance-api';
import type { Paginated } from '@/lib/crm-types';
import { formatDate, formatDateTime } from '@/lib/format';
import { useFormatMoney } from '@/lib/use-money';
import { hasPermission } from '@/lib/session';

// =============================================================================
// Tipo unificado
// =============================================================================
// Mensalidades (ContractInvoice) e cobranças avulsas (OneTimeCharge) têm
// shapes parecidos mas não idênticos. Normalizamos pra UnifiedCharge pra um
// fluxo único de listagem/filtro/pagamento. O `kind` discrimina pra rotear o
// pay() pro endpoint certo.
type UnifiedStatus = InvoiceStatus | OneTimeChargeStatus; // OPEN, PAID, OVERDUE, CANCELLED
interface UnifiedCharge {
  id: string;
  kind: 'INVOICE' | 'CHARGE';
  code: string | null;
  description: string;
  amount: number;
  dueDate: string;
  status: UnifiedStatus;
  paidAt: string | null;
  customer: { id: string; displayName: string } | null;
  contractId?: string;
  raw: ContractInvoice | OneTimeCharge;
}

const STATUS_TONE: Record<UnifiedStatus, 'info' | 'success' | 'warning' | 'danger'> = {
  OPEN: 'info',
  PAID: 'success',
  OVERDUE: 'danger',
  CANCELLED: 'warning',
};

type TypeFilter = 'ALL' | 'INVOICE' | 'CHARGE';

/**
 * /finance/charges — listagem unificada do financeiro a receber.
 *
 * Junta:
 *   - Mensalidades de contratos (ContractInvoice) — recorrentes.
 *   - Cobranças avulsas (OneTimeCharge)            — pontuais.
 *
 * Pagamento usa o PaymentDialog (caixa obrigatório, método, desconto). Cada
 * tipo encaminha pro endpoint certo (`/contract-invoices/:id/pay` vs
 * `/charges/:id/pay`) — backend cria CashMovement automático em ambos.
 */
export default function ChargesListPage() {
  const t = useTranslations('charges');
  const tStatus = useTranslations('charges.statusLabel');
  const tType = useTranslations('charges.typeBadge');
  const tCommon = useTranslations('common');
  const tx = useTranslations('chargesExtra');
  const formatMoney = useFormatMoney();
  const canCreateCharge = hasPermission('finance.charges.write');
  const canReverse = hasPermission('cash_registers.manage');

  async function doReverse(r: UnifiedCharge) {
    if (!confirm(tx('reverseConfirm'))) return;
    try {
      if (r.kind === 'INVOICE') await contractInvoicesApi.unpay(r.id);
      else await chargesApi.unpay(r.id);
      toast.success(tx('reversedToast'));
      await refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.friendlyMessage : tCommon('error'));
    }
  }

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<UnifiedStatus | ''>('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('ALL');

  // Buscamos as duas fontes em paralelo. pageSize alto pra simplificar — a
  // paginação real (cliente) acontece no array unificado abaixo. Quando a
  // base crescer, vale levar a paginação pro backend num endpoint /finance/
  // unificado, mas hoje 200 + 200 cobre até alguns milhares de contratos.
  const invoicesKey =
    typeFilter !== 'CHARGE'
      ? contractInvoicesApi.listPath({
          pageSize: 200,
          ...(status && status !== 'OVERDUE' ? { status: status as InvoiceStatus } : {}),
          // OVERDUE é status próprio do invoice, mas o backend lista direto.
          ...(status === 'OVERDUE' ? { status: 'OVERDUE' } : {}),
          sortBy: 'dueDate',
          sortDir: 'desc',
        })
      : null;
  const chargesKey =
    typeFilter !== 'INVOICE'
      ? chargesApi.listPath({
          pageSize: 200,
          search: search || undefined,
          // OneTimeCharge não tem OVERDUE — só OPEN/PAID/CANCELLED. Filtramos
          // depois do merge pra deixar a UI consistente.
          ...(status && status !== 'OVERDUE'
            ? { status: status as OneTimeChargeStatus }
            : {}),
        })
      : null;

  const { data: invoicesResp, isLoading: loadingInv, mutate: mutateInv } =
    useSWR<Paginated<ContractInvoice>>(invoicesKey);
  const { data: chargesResp, isLoading: loadingCh, mutate: mutateCh } =
    useSWR<Paginated<OneTimeCharge>>(chargesKey);

  const isLoading =
    (typeFilter !== 'CHARGE' && loadingInv && !invoicesResp) ||
    (typeFilter !== 'INVOICE' && loadingCh && !chargesResp);

  const rows = useMemo<UnifiedCharge[]>(() => {
    const list: UnifiedCharge[] = [];
    if (typeFilter !== 'CHARGE' && invoicesResp) {
      for (const inv of invoicesResp.data) {
        list.push({
          id: inv.id,
          kind: 'INVOICE',
          code: inv.contract?.code ?? null,
          description: inv.reference ?? 'Mensalidade',
          amount: inv.amount,
          dueDate: inv.dueDate,
          status: inv.status,
          paidAt: inv.paidAt,
          customer: inv.contract?.customerId
            ? { id: inv.contract.customerId, displayName: '' }
            : null,
          contractId: inv.contractId,
          raw: inv,
        });
      }
    }
    if (typeFilter !== 'INVOICE' && chargesResp) {
      for (const ch of chargesResp.data) {
        list.push({
          id: ch.id,
          kind: 'CHARGE',
          code: ch.code,
          description: ch.description,
          amount: ch.amount,
          dueDate: ch.dueDate,
          status: ch.status,
          paidAt: ch.paidAt,
          customer: ch.customer
            ? { id: ch.customer.id, displayName: ch.customer.displayName }
            : null,
          contractId: ch.contractId ?? undefined,
          raw: ch,
        });
      }
    }
    // Filtro de status pós-merge (cobre o caso OneTimeCharge sem OVERDUE).
    let filtered = status ? list.filter((r) => r.status === status) : list;
    // Filtro de busca client-side (textual em descrição/código). O backend de
    // invoices ainda não tem search; faz sentido filtrar aqui pra UX uniforme.
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      filtered = filtered.filter(
        (r) =>
          r.description.toLowerCase().includes(q) ||
          (r.code ?? '').toLowerCase().includes(q),
      );
    }
    return filtered.sort((a, b) => (a.dueDate < b.dueDate ? 1 : -1));
  }, [invoicesResp, chargesResp, typeFilter, status, search]);

  const [creating, setCreating] = useState(false);
  const [paying, setPaying] = useState<UnifiedCharge | null>(null);
  const [cancelling, setCancelling] = useState<UnifiedCharge | null>(null);

  async function refresh() {
    await Promise.all([mutateInv?.(), mutateCh?.()]);
  }

  if (isLoading) return <PageLoader label={tCommon('loading')} />;

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-text-muted">{t('subtitle')}</p>
        </div>
        {canCreateCharge && (
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5" />
            {t('new')}
          </Button>
        )}
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder={tCommon('search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <Select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
          className="w-44"
        >
          <option value="ALL">{t('typeFilterAll')}</option>
          <option value="INVOICE">{t('typeFilterInvoice')}</option>
          <option value="CHARGE">{t('typeFilterCharge')}</option>
        </Select>
        <Select
          value={status}
          onChange={(e) => setStatus(e.target.value as UnifiedStatus | '')}
          className="w-40"
        >
          <option value="">{tCommon('all')}</option>
          <option value="OPEN">{tStatus('OPEN')}</option>
          <option value="PAID">{tStatus('PAID')}</option>
          <option value="OVERDUE">{tStatus('OVERDUE')}</option>
          <option value="CANCELLED">{tStatus('CANCELLED')}</option>
        </Select>
      </div>

      <div className="overflow-x-auto rounded-md border border-border bg-surface">
        <table className="min-w-full text-sm">
          <thead className="bg-surface-muted text-left text-[11px] font-semibold uppercase tracking-wider text-text-muted">
            <tr>
              <th className="px-3 py-2">{tCommon('type')}</th>
              <th className="px-3 py-2">{tCommon('code')}</th>
              <th className="px-3 py-2">{t('fields.customer')}</th>
              <th className="px-3 py-2">{t('fields.description')}</th>
              <th className="px-3 py-2 text-right">{t('fields.amount')}</th>
              <th className="px-3 py-2">{t('fields.dueDate')}</th>
              <th className="px-3 py-2">{tCommon('status')}</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-text-muted">
                  {tCommon('nothingHere')}
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={`${r.kind}-${r.id}`} className="hover:bg-surface-hover">
                  <td className="px-3 py-2">
                    <Badge tone={r.kind === 'INVOICE' ? 'info' : 'warning'}>
                      {tType(r.kind)}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 font-medium text-text">
                    {r.code ?? `#${r.id.slice(0, 8)}`}
                  </td>
                  <td className="px-3 py-2 text-text-muted">
                    {r.kind === 'INVOICE' ? (
                      r.contractId ? (
                        <Link
                          href={`/contracts/${r.contractId}`}
                          className="text-brand-500 hover:underline"
                        >
                          {tx('seeContract')}
                        </Link>
                      ) : (
                        '—'
                      )
                    ) : r.customer ? (
                      <Link
                        href={`/customers/${r.customer.id}`}
                        className="text-brand-500 hover:underline"
                      >
                        {r.customer.displayName}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-3 py-2 text-text-muted">{r.description}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatMoney(r.amount)}
                  </td>
                  <td className="px-3 py-2 text-text-muted">
                    {formatDate(r.dueDate)}
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={STATUS_TONE[r.status]}>{tStatus(r.status)}</Badge>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {(r.status === 'OPEN' || r.status === 'OVERDUE') && (
                      <div className="flex justify-end gap-1">
                        <Button size="sm" onClick={() => setPaying(r)}>
                          {t('actions.pay')}
                        </Button>
                        {r.kind === 'CHARGE' && canCreateCharge && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setCancelling(r)}
                          >
                            {tCommon('cancel')}
                          </Button>
                        )}
                      </div>
                    )}
                    {r.status === 'PAID' && (
                      <div className="flex items-center justify-end gap-2">
                        {r.paidAt && (
                          <span className="text-2xs text-text-muted">
                            {formatDateTime(r.paidAt)}
                          </span>
                        )}
                        {canReverse && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-red-600 dark:text-red-400"
                            onClick={() => void doReverse(r)}
                          >
                            {tx('reverse')}
                          </Button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <NewChargeDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={() => void refresh()}
      />

      {paying && (
        <PaymentDialog
          open
          onOpenChange={(v) => !v && setPaying(null)}
          amount={paying.amount}
          description={`${paying.code ?? ''} · ${paying.description}`}
          onConfirm={async (input) => {
            const { kind, id: payId } = paying;
            if (kind === 'INVOICE') {
              await contractInvoicesApi.pay(payId, input);
            } else {
              await chargesApi.pay(payId, input);
            }
            toast.success(tCommon('success'));
            await refresh();
            // Abre recibo matricial em nova aba.
            window.open(
              `/receipts/${kind === 'INVOICE' ? 'invoice' : 'charge'}/${payId}`,
              '_blank',
            );
          }}
        />
      )}

      <ConfirmDialog
        open={!!cancelling}
        onClose={() => setCancelling(null)}
        onConfirm={async () => {
          if (!cancelling) return;
          try {
            if (cancelling.kind === 'INVOICE') {
              await contractInvoicesApi.cancel(cancelling.id);
            } else {
              await chargesApi.cancel(cancelling.id);
            }
            toast.success(tCommon('success'));
            setCancelling(null);
            await refresh();
          } catch (err) {
            toast.error(err instanceof ApiError ? err.friendlyMessage : tCommon('error'));
          }
        }}
        title={t('actions.cancel')}
        message={tx('cancelWarning')}
        confirmLabel={tCommon('confirm')}
        variant="danger"
      />
    </div>
  );
}

