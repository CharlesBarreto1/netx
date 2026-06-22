'use client';

import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/Button';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { FieldError, Input, Label, Textarea } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api';
import { cashRegistersApi, type CashRegister, type PaymentMethod } from '@/lib/finance-api';
import { hasPermission } from '@/lib/session';
import {
  stockApi,
  type CreatePurchaseInput,
  type Product,
  type Purchase,
  type PurchaseAuditEntry,
  type PurchaseItemInput,
  type PurchaseItemSerial,
  type PurchaseItemSerials,
  type PurchasePaymentInput,
  type StockLocation,
  type Supplier,
} from '@/lib/stock-api';

const PAYMENT_METHODS: PaymentMethod[] = [
  'CASH',
  'PIX',
  'CARD',
  'BANK_TRANSFER',
  'BOLETO',
  'OTHER',
];

// Acima disso, não renderiza a grade de inputs inline (lote grande digita-se
// depois no gerenciador de seriais, em lotes). Evita travar a tela com milhares
// de campos.
const MAX_INLINE_SERIALS = 60;

type PayCondition = 'NONE' | 'CASH' | 'INSTALLMENTS';

function derivePayCondition(p?: Purchase): PayCondition {
  const payables = p?.payables ?? [];
  if (payables.length === 0) return 'NONE';
  if (
    payables.length === 1 &&
    payables[0].installmentCount === 1 &&
    payables[0].status === 'PAID'
  ) {
    return 'CASH';
  }
  return 'INSTALLMENTS';
}

export default function PurchasesPage() {
  const { data, isLoading, error, mutate } = useSWR<Purchase[]>(
    stockApi.purchasesPath(),
    () => stockApi.listPurchases(),
  );
  const canCreate = hasPermission('stock.purchase.create');
  const canUpdate = hasPermission('stock.purchase.update');
  const canDelete = hasPermission('stock.purchase.delete');
  const t = useTranslations('stock.purchases');
  const tc = useTranslations('common');

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Purchase | null>(null);
  const [viewing, setViewing] = useState<Purchase | null>(null);
  const [deleting, setDeleting] = useState<Purchase | null>(null);
  const [managingSerials, setManagingSerials] = useState<Purchase | null>(null);
  const [busy, setBusy] = useState(false);

  async function doDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      await stockApi.deletePurchase(deleting.id);
      toast.success(t('deletedToast'));
      setDeleting(null);
      await mutate();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.friendlyMessage : tc('error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {t('subtitle')}
          </p>
        </div>
        {canCreate && <Button onClick={() => setCreating(true)}>{t('new')}</Button>}
      </header>

      {isLoading && <PageLoader />}
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {t('loadFailed')}
        </div>
      )}

      {data && data.length === 0 && (
        <p className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
          {t('empty')}
        </p>
      )}

      {data && data.length > 0 && (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
              <thead className="bg-slate-50 dark:bg-slate-900/40">
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  <th className="px-4 py-3">{t('th.date')}</th>
                  <th className="px-4 py-3">{t('th.supplier')}</th>
                  <th className="px-4 py-3">{t('th.invoice')}</th>
                  <th className="px-4 py-3 text-right">{t('th.items')}</th>
                  <th className="px-4 py-3 text-right">{t('th.total')}</th>
                  <th className="px-4 py-3">{t('th.payment')}</th>
                  <th className="px-4 py-3">{t('th.operator')}</th>
                  <th className="px-4 py-3 text-right">{tc('actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {data.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/60">
                    <td className="px-4 py-3 text-slate-700 dark:text-slate-200">
                      {new Date(p.date).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">{p.supplierName ?? '—'}</td>
                    <td className="px-4 py-3 font-mono text-xs">{p.invoiceNumber ?? '—'}</td>
                    <td className="px-4 py-3 text-right">
                      {p.items.length}
                      <SerialProgress purchase={p} />
                    </td>
                    <td className="px-4 py-3 text-right">{formatMoney(p.totalCost)}</td>
                    <td className="px-4 py-3"><PaymentBadge purchase={p} /></td>
                    <td className="px-4 py-3 text-xs text-slate-500">{p.createdByName ?? '—'}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setViewing(p)}>
                          {t('view')}
                        </Button>
                        {canUpdate && hasPatrimonial(p) && (
                          <Button variant="ghost" size="sm" onClick={() => setManagingSerials(p)}>
                            {t('serials.action')}
                          </Button>
                        )}
                        {canUpdate && (
                          <Button variant="ghost" size="sm" onClick={() => setEditing(p)}>
                            {tc('edit')}
                          </Button>
                        )}
                        {canDelete && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-600 dark:text-red-400"
                            onClick={() => setDeleting(p)}
                          >
                            {tc('delete')}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {creating && (
        <PurchaseFormModal
          onClose={() => setCreating(false)}
          onSaved={async () => {
            setCreating(false);
            await mutate();
          }}
        />
      )}

      {editing && (
        <PurchaseFormModal
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await mutate();
          }}
        />
      )}

      {viewing && <PurchaseDetailsModal purchase={viewing} onClose={() => setViewing(null)} />}

      {managingSerials && (
        <SerialManagerModal
          purchase={managingSerials}
          onClose={() => setManagingSerials(null)}
          onChanged={() => mutate()}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={doDelete}
        title={t('deleteTitle')}
        message={t('deleteMessage')}
        confirmLabel={tc('delete')}
        variant="danger"
        loading={busy}
      />
    </div>
  );
}

function formatMoney(v: string | number | null): string {
  if (v == null) return '—';
  const n = typeof v === 'string' ? Number(v) : v;
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Tem ao menos um item PATRIMONIAL (que comporta seriais). */
function hasPatrimonial(p: Purchase): boolean {
  return p.items.some((it) => it.productType === 'PATRIMONIAL');
}

/** Soma de seriais cadastrados vs. esperados nos itens patrimoniais da compra. */
function serialTotals(p: Purchase): { registered: number; expected: number } {
  let registered = 0;
  let expected = 0;
  for (const it of p.items) {
    if (it.productType !== 'PATRIMONIAL') continue;
    registered += it.serials.length;
    expected += Math.floor(Number(it.quantity));
  }
  return { registered, expected };
}

// Badge "seriais X/N" sob a contagem de itens — âmbar quando ainda falta digitar.
function SerialProgress({ purchase }: { purchase: Purchase }) {
  const t = useTranslations('stock.purchases');
  const { registered, expected } = serialTotals(purchase);
  if (expected === 0) return null;
  const complete = registered >= expected;
  const cls = complete
    ? 'text-slate-400'
    : 'text-amber-600 dark:text-amber-400 font-medium';
  return (
    <span className={`block text-[11px] ${cls}`}>
      {t('serials.progress', { registered, expected })}
    </span>
  );
}

// Situação do financeiro da compra: — (sem parcelas), À vista, ou x/y pagas
// (vermelho se tem parcela vencida).
function PaymentBadge({ purchase }: { purchase: Purchase }) {
  const t = useTranslations('stock.purchases');
  const payables = purchase.payables ?? [];
  if (payables.length === 0) {
    return <span className="text-xs text-slate-400">—</span>;
  }
  if (
    payables.length === 1 &&
    payables[0].installmentCount === 1 &&
    payables[0].status === 'PAID'
  ) {
    return (
      <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
        {t('payment.cashBadge')}
      </span>
    );
  }
  const paid = payables.filter((p) => p.status === 'PAID').length;
  const today = new Date().toISOString().slice(0, 10);
  const hasOverdue = payables.some(
    (p) => p.status === 'OPEN' && p.dueDate.slice(0, 10) < today,
  );
  const allPaid = paid === payables.length;
  const cls = allPaid
    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
    : hasOverdue
      ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
      : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300';
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {t('payment.installmentsBadge', { paid, total: payables.length })}
    </span>
  );
}

// =============================================================================
// DETAILS — modal read-only com items + seriais
// =============================================================================
function PurchaseDetailsModal({
  purchase,
  onClose,
}: {
  purchase: Purchase;
  onClose: () => void;
}) {
  const t = useTranslations('stock.purchases');
  const tc = useTranslations('common');
  const { data: auditTrail } = useSWR<PurchaseAuditEntry[]>(
    stockApi.purchaseAuditPath(purchase.id),
    () => stockApi.getPurchaseAudit(purchase.id),
  );
  return (
    <Modal open onClose={onClose} title={t('details.title', { date: new Date(purchase.date).toLocaleDateString() })}>
      <div className="space-y-4">
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs text-slate-500">{t('th.supplier')}</dt>
            <dd>{purchase.supplierName ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">{t('th.invoice')}</dt>
            <dd className="font-mono">{purchase.invoiceNumber ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">{t('th.total')}</dt>
            <dd className="font-semibold">{formatMoney(purchase.totalCost)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">{t('details.registeredBy')}</dt>
            <dd>
              {purchase.createdByName ?? '—'}
              <span className="block text-xs text-slate-500">
                {new Date(purchase.createdAt).toLocaleString()}
              </span>
            </dd>
          </div>
          {purchase.updatedById && (
            <div>
              <dt className="text-xs text-slate-500">{t('details.editedBy')}</dt>
              <dd>
                {purchase.updatedByName ?? '—'}
                {purchase.updatedAt && (
                  <span className="block text-xs text-slate-500">
                    {new Date(purchase.updatedAt).toLocaleString()}
                  </span>
                )}
              </dd>
            </div>
          )}
        </dl>

        {purchase.notes && (
          <div className="rounded-md bg-slate-50 p-3 text-sm dark:bg-slate-900/40">
            <p className="text-xs text-slate-500 mb-1">{tc('notes')}</p>
            <p>{purchase.notes}</p>
          </div>
        )}

        <div>
          <h3 className="text-sm font-semibold mb-2">{t('items.heading', { count: purchase.items.length })}</h3>
          <div className="rounded-md border border-slate-200 dark:border-slate-700 overflow-hidden">
            <table className="min-w-full divide-y divide-slate-200 text-xs dark:divide-slate-700">
              <thead className="bg-slate-50 dark:bg-slate-900/40">
                <tr className="text-left">
                  <th className="px-3 py-2">{t('th.product')}</th>
                  <th className="px-3 py-2">{t('th.location')}</th>
                  <th className="px-3 py-2 text-right">{t('th.qty')}</th>
                  <th className="px-3 py-2 text-right">{t('th.unitCost')}</th>
                  <th className="px-3 py-2 text-right">{t('th.total')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {purchase.items.map((it) => (
                  <tr key={it.id}>
                    <td className="px-3 py-2">
                      <div>
                        <strong>{it.productName ?? it.productId.slice(0, 8)}</strong>
                        {it.productType === 'PATRIMONIAL' && it.serials.length > 0 && (
                          <p className="text-xs text-slate-500 mt-0.5">
                            {t('serialsLabel', { serials: it.serials.join(', ') })}
                          </p>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-slate-600">{it.locationName ?? '—'}</td>
                    <td className="px-3 py-2 text-right">{it.quantity}</td>
                    <td className="px-3 py-2 text-right">{formatMoney(it.unitCost)}</td>
                    <td className="px-3 py-2 text-right font-semibold">
                      {formatMoney(it.totalCost)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {(purchase.payables ?? []).length > 0 && (
          <div>
            <h3 className="text-sm font-semibold mb-2">{t('payment.heading')}</h3>
            <div className="rounded-md border border-slate-200 dark:border-slate-700 overflow-hidden">
              <table className="min-w-full divide-y divide-slate-200 text-xs dark:divide-slate-700">
                <thead className="bg-slate-50 dark:bg-slate-900/40">
                  <tr className="text-left">
                    <th className="px-3 py-2">{t('payment.installment')}</th>
                    <th className="px-3 py-2">{t('payment.dueDate')}</th>
                    <th className="px-3 py-2 text-right">{t('payment.amount')}</th>
                    <th className="px-3 py-2">{t('payment.status')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                  {(purchase.payables ?? []).map((pay) => (
                    <tr key={pay.id}>
                      <td className="px-3 py-2">
                        {pay.installmentNumber}/{pay.installmentCount}
                      </td>
                      <td className="px-3 py-2">
                        {new Date(pay.dueDate).toLocaleDateString()}
                      </td>
                      <td className="px-3 py-2 text-right">{formatMoney(pay.amount)}</td>
                      <td className="px-3 py-2">
                        {pay.status === 'PAID'
                          ? t('payment.statusPaid')
                          : pay.status === 'OPEN'
                            ? t('payment.statusOpen')
                            : t('payment.statusCancelled')}
                        {pay.paidAt && (
                          <span className="block text-slate-500">
                            {new Date(pay.paidAt).toLocaleDateString()}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {auditTrail && auditTrail.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold mb-2">{t('details.auditHeading')}</h3>
            <ul className="space-y-1 rounded-md border border-slate-200 p-3 text-xs dark:border-slate-700">
              {auditTrail.map((entry) => (
                <li key={entry.id} className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-mono text-slate-500">
                    {new Date(entry.createdAt).toLocaleString()}
                  </span>
                  <span className="font-medium">
                    {entry.action === 'purchase.created' && t('details.auditCreated')}
                    {entry.action === 'purchase.updated' && t('details.auditUpdated')}
                    {entry.action === 'purchase.deleted' && t('details.auditDeleted')}
                    {!['purchase.created', 'purchase.updated', 'purchase.deleted'].includes(entry.action) && entry.action}
                  </span>
                  <span className="text-slate-500">{entry.userName ?? '—'}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex justify-end pt-2">
          <Button variant="ghost" onClick={onClose}>{tc('close')}</Button>
        </div>
      </div>
    </Modal>
  );
}

// =============================================================================
// FORM — multi-item com seriais condicionais (PATRIMONIAL)
// =============================================================================
function PurchaseFormModal({
  initial,
  onClose,
  onSaved,
}: {
  /** Compra existente → modo edição (REPLACE: reverte e reaplica o estoque). */
  initial?: Purchase;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('stock.purchases');
  const tc = useTranslations('common');
  const tpm = useTranslations('finance.paymentMethod');
  const { data: suppliers } = useSWR<Supplier[]>(stockApi.suppliersPath({ isActive: true }), () =>
    stockApi.listSuppliers({ isActive: true }),
  );
  const { data: products } = useSWR<Product[]>(stockApi.productsPath({ isActive: true }), () =>
    stockApi.listProducts({ isActive: true }),
  );
  const { data: locations } = useSWR<StockLocation[]>(stockApi.locationsPath({ isActive: true }), () =>
    stockApi.listLocations({ isActive: true }),
  );

  const productsById = useMemo(() => {
    const m = new Map<string, Product>();
    products?.forEach((p) => m.set(p.id, p));
    return m;
  }, [products]);

  const [supplierId, setSupplierId] = useState(initial?.supplierId ?? '');
  const [invoiceNumber, setInvoiceNumber] = useState(initial?.invoiceNumber ?? '');
  const [date, setDate] = useState(() =>
    (initial?.date ?? new Date().toISOString()).slice(0, 10),
  );
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [items, setItems] = useState<PurchaseItemInput[]>(() =>
    initial
      ? initial.items.map((it) => ({
          productId: it.productId,
          locationId: it.locationId,
          quantity: Number(it.quantity),
          unitCost: Number(it.unitCost),
          serials: [...it.serials],
          notes: it.notes,
        }))
      : [{ productId: '', locationId: '', quantity: 1, unitCost: 0, serials: [] }],
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Pagamento (contas a pagar) ─────────────────────────────────────────────
  const initialPayables = initial?.payables ?? [];
  const [payCondition, setPayCondition] = useState<PayCondition>(() =>
    derivePayCondition(initial),
  );
  const [payCashRegisterId, setPayCashRegisterId] = useState(
    initialPayables[0]?.cashRegisterId ?? '',
  );
  const [payVia, setPayVia] = useState(initialPayables[0]?.paidVia ?? '');
  const [installments, setInstallments] = useState<
    Array<{ dueDate: string; amount: number }>
  >(() =>
    derivePayCondition(initial) === 'INSTALLMENTS'
      ? initialPayables.map((p) => ({
          dueDate: p.dueDate.slice(0, 10),
          amount: Number(p.amount),
        }))
      : [],
  );
  const [instCount, setInstCount] = useState(installments.length || 2);
  const [instFirstDue, setInstFirstDue] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().slice(0, 10);
  });
  // Caixas: pode falhar (403) pra quem não tem permissão de finance — nesse
  // caso o select fica vazio e a compra à vista sai "sem caixa".
  const { data: cashRegisters } = useSWR<CashRegister[]>(
    payCondition === 'CASH' ? cashRegistersApi.listPath() : null,
    () => cashRegistersApi.list(),
    { shouldRetryOnError: false },
  );

  function generateInstallments() {
    const count = Math.max(1, Math.min(60, Math.floor(instCount)));
    const per = Math.floor((total / count) * 100) / 100;
    const rows: Array<{ dueDate: string; amount: number }> = [];
    const first = new Date(`${instFirstDue}T00:00:00`);
    for (let i = 0; i < count; i++) {
      const due = new Date(first);
      due.setMonth(due.getMonth() + i);
      rows.push({
        dueDate: due.toISOString().slice(0, 10),
        // Última parcela absorve o resto do arredondamento.
        amount:
          i === count - 1
            ? Math.round((total - per * (count - 1)) * 100) / 100
            : per,
      });
    }
    setInstallments(rows);
  }

  function updateInstallment(
    idx: number,
    patch: Partial<{ dueDate: string; amount: number }>,
  ) {
    const next = [...installments];
    next[idx] = { ...next[idx], ...patch };
    setInstallments(next);
  }

  function updateItem(idx: number, patch: Partial<PurchaseItemInput>) {
    const next = [...items];
    next[idx] = { ...next[idx], ...patch };
    setItems(next);
  }

  function addItem() {
    setItems([...items, { productId: '', locationId: '', quantity: 1, unitCost: 0, serials: [] }]);
  }

  function removeItem(idx: number) {
    if (items.length === 1) return;
    setItems(items.filter((_, i) => i !== idx));
  }

  const total = items.reduce(
    (acc, it) => acc + Number(it.quantity || 0) * Number(it.unitCost || 0),
    0,
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!supplierId) return setError(t('errors.selectSupplier'));
    if (items.length === 0) return setError(t('errors.addItem'));

    // Validação client-side dos serials pra patrimoniais
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it.productId) return setError(t('errors.itemSelectProduct', { n: i + 1 }));
      if (!it.locationId) return setError(t('errors.itemSelectLocation', { n: i + 1 }));
      const product = productsById.get(it.productId);
      const qty = Number(it.quantity);
      const cost = Number(it.unitCost);
      if (!Number.isFinite(qty) || qty <= 0)
        return setError(t('errors.itemInvalidQty', { n: i + 1 }));
      if (!Number.isFinite(cost) || cost <= 0)
        return setError(t('errors.itemInvalidCost', { n: i + 1 }));
      if (product?.type === 'PATRIMONIAL') {
        // Lançamento parcial é permitido: valida só os preenchidos (≤ qty, sem
        // duplicar). O restante entra depois pelo gerenciador de seriais.
        const filled = (it.serials ?? []).map((s) => s.trim()).filter(Boolean);
        if (filled.length > qty) {
          return setError(
            t('errors.serialsTooMany', { n: i + 1, product: product.name, expected: qty, got: filled.length }),
          );
        }
        if (new Set(filled).size !== filled.length) {
          return setError(t('errors.serialsDuplicate', { n: i + 1 }));
        }
      } else {
        if ((it.serials ?? []).length > 0) {
          return setError(t('errors.serialsNotAllowed', { n: i + 1 }));
        }
      }
    }

    // Validação do pagamento (contas a pagar)
    let payment: PurchasePaymentInput | null = null;
    if (payCondition === 'CASH') {
      payment = {
        condition: 'CASH',
        cashRegisterId: payCashRegisterId || null,
        ...(payVia ? { paidVia: payVia } : {}),
      };
    } else if (payCondition === 'INSTALLMENTS') {
      if (installments.length === 0) return setError(t('payment.errors.noInstallments'));
      for (let i = 0; i < installments.length; i++) {
        const inst = installments[i];
        if (!inst.dueDate) return setError(t('payment.errors.missingDueDate', { n: i + 1 }));
        if (!Number.isFinite(inst.amount) || inst.amount <= 0)
          return setError(t('payment.errors.invalidAmount', { n: i + 1 }));
      }
      const sum = installments.reduce((acc, p) => acc + p.amount, 0);
      if (Math.abs(sum - total) > 0.01) {
        return setError(
          t('payment.errors.sumMismatch', {
            sum: formatMoney(sum),
            total: formatMoney(total),
          }),
        );
      }
      payment = { condition: 'INSTALLMENTS', installments };
    }

    setSubmitting(true);
    try {
      const payload: CreatePurchaseInput = {
        supplierId,
        invoiceNumber: invoiceNumber || null,
        date,
        notes: notes || null,
        payment,
        items: items.map((it) => {
          const isPat = productsById.get(it.productId)?.type === 'PATRIMONIAL';
          return {
            ...it,
            quantity: Number(it.quantity),
            unitCost: Number(it.unitCost),
            // Só seriais preenchidos vão pro backend (parcial OK); consumível vazio.
            serials: isPat ? (it.serials ?? []).map((s) => s.trim()).filter(Boolean) : [],
          };
        }),
      };
      if (initial) {
        await stockApi.updatePurchase(initial.id, payload);
      } else {
        await stockApi.createPurchase(payload);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.friendlyMessage : t('errors.saveFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={initial ? t('editTitle') : t('new')} size="xl">
      <form onSubmit={handleSubmit} className="space-y-4">
        {initial && (
          <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
            {t('editWarning')}
          </p>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <div>
            <Label>{t('form.supplierRequired')}</Label>
            <select
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              required
            >
              <option value="">—</option>
              {suppliers?.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <Label>{t('th.invoice')}</Label>
            <Input
              value={invoiceNumber}
              onChange={(e) => setInvoiceNumber(e.target.value)}
              placeholder="000123"
            />
          </div>
          <div>
            <Label>{t('form.dateRequired')}</Label>
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold">{t('th.items')}</h3>
            <Button type="button" variant="ghost" size="sm" onClick={addItem}>
              {t('form.addItem')}
            </Button>
          </div>

          <div className="space-y-3">
            {items.map((it, idx) => {
              const product = productsById.get(it.productId);
              const isPatrimonial = product?.type === 'PATRIMONIAL';
              return (
                <div
                  key={idx}
                  className="rounded-md border border-slate-200 p-3 dark:border-slate-700"
                >
                  <div className="grid grid-cols-12 gap-2">
                    <div className="col-span-4">
                      <Label className="text-xs">{t('th.product')}</Label>
                      <select
                        className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
                        value={it.productId}
                        onChange={(e) => updateItem(idx, { productId: e.target.value, serials: [] })}
                      >
                        <option value="">—</option>
                        {products?.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.sku} · {p.name} ({p.type === 'PATRIMONIAL' ? t('form.patShort') : t('form.consShort')})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="col-span-3">
                      <Label className="text-xs">{t('th.location')}</Label>
                      <select
                        className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
                        value={it.locationId}
                        onChange={(e) => updateItem(idx, { locationId: e.target.value })}
                      >
                        <option value="">—</option>
                        {locations?.map((l) => (
                          <option key={l.id} value={l.id}>{l.code} — {l.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="col-span-2">
                      <Label className="text-xs">{t('th.qty')}</Label>
                      <Input
                        type="number"
                        step="0.0001"
                        min="0.0001"
                        value={it.quantity}
                        onChange={(e) => {
                          const qty = Number(e.target.value);
                          const floored = Math.max(0, Math.floor(qty));
                          updateItem(idx, {
                            quantity: e.target.value === '' ? 1 : qty,
                            // Patrimonial: prepara a grade de seriais até o teto;
                            // lote grande mantém o que já tem (digita no gerenciador).
                            serials: isPatrimonial
                              ? floored <= MAX_INLINE_SERIALS
                                ? Array.from({ length: floored }, (_, i) => it.serials?.[i] ?? '')
                                : (it.serials ?? []).slice(0, floored)
                              : [],
                          });
                        }}
                      />
                    </div>
                    <div className="col-span-2">
                      <Label className="text-xs">{t('th.unitCost')}</Label>
                      <Input
                        type="number"
                        step="0.0001"
                        min="0.0001"
                        value={it.unitCost}
                        onChange={(e) =>
                          updateItem(idx, { unitCost: e.target.value === '' ? 0 : Number(e.target.value) })
                        }
                      />
                    </div>
                    <div className="col-span-1 flex items-end justify-end">
                      {items.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeItem(idx)}
                          className="text-xs text-red-600 hover:underline"
                        >
                          {t('form.remove')}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Seriais — só pra patrimonial. Opcionais: pode lançar
                      parcial (ou nenhum) e completar depois no gerenciador. */}
                  {isPatrimonial && Number(it.quantity) > 0 && (
                    <div className="mt-2">
                      <Label className="text-xs">
                        {t('form.serialsOptional', {
                          filled: (it.serials ?? []).filter((s) => s.trim()).length,
                          total: Math.floor(Number(it.quantity)),
                        })}
                      </Label>
                      {Math.floor(Number(it.quantity)) <= MAX_INLINE_SERIALS ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                          {Array.from({ length: Math.floor(Number(it.quantity)) }, (_, sidx) => (
                            <Input
                              key={sidx}
                              placeholder={t('form.serialPlaceholder', { n: sidx + 1 })}
                              value={it.serials?.[sidx] ?? ''}
                              onChange={(e) => {
                                const next = [...(it.serials ?? [])];
                                next[sidx] = e.target.value;
                                updateItem(idx, { serials: next });
                              }}
                            />
                          ))}
                        </div>
                      ) : (
                        <p className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-2 text-xs text-slate-500 dark:border-slate-600 dark:bg-slate-900/40">
                          {t('form.largeLotHint', { total: Math.floor(Number(it.quantity)) })}
                        </p>
                      )}
                    </div>
                  )}

                  <div className="mt-1 text-right text-xs text-slate-500">
                    {t('form.subtotal', { value: formatMoney(Number(it.quantity) * Number(it.unitCost)) })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Pagamento — gera as parcelas no contas a pagar */}
        <div className="rounded-md border border-slate-200 p-3 dark:border-slate-700">
          <h3 className="text-sm font-semibold mb-2">{t('payment.heading')}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">{t('payment.condition')}</Label>
              <select
                className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
                value={payCondition}
                onChange={(e) => setPayCondition(e.target.value as PayCondition)}
              >
                <option value="NONE">{t('payment.conditionNone')}</option>
                <option value="CASH">{t('payment.conditionCash')}</option>
                <option value="INSTALLMENTS">{t('payment.conditionInstallments')}</option>
              </select>
            </div>

            {payCondition === 'CASH' && (
              <>
                <div>
                  <Label className="text-xs">{t('payment.method')}</Label>
                  <select
                    className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
                    value={payVia}
                    onChange={(e) => setPayVia(e.target.value)}
                  >
                    <option value="">—</option>
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m} value={m}>{tpm(m as 'CASH')}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label className="text-xs">{t('payment.cashRegister')}</Label>
                  <select
                    className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
                    value={payCashRegisterId}
                    onChange={(e) => setPayCashRegisterId(e.target.value)}
                  >
                    <option value="">{t('payment.noCashRegister')}</option>
                    {cashRegisters?.filter((r) => r.isActive).map((r) => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-slate-500">{t('payment.cashRegisterHelp')}</p>
                </div>
              </>
            )}
          </div>

          {payCondition === 'INSTALLMENTS' && (
            <div className="mt-3 space-y-2">
              <div className="flex flex-wrap items-end gap-2">
                <div>
                  <Label className="text-xs">{t('payment.installmentCount')}</Label>
                  <Input
                    type="number"
                    min="1"
                    max="60"
                    step="1"
                    className="w-24"
                    value={instCount}
                    onChange={(e) => setInstCount(Number(e.target.value))}
                  />
                </div>
                <div>
                  <Label className="text-xs">{t('payment.firstDueDate')}</Label>
                  <Input
                    type="date"
                    value={instFirstDue}
                    onChange={(e) => setInstFirstDue(e.target.value)}
                  />
                </div>
                <Button type="button" variant="ghost" size="sm" onClick={generateInstallments}>
                  {t('payment.generate')}
                </Button>
              </div>

              {installments.length > 0 && (
                <div className="space-y-1">
                  {installments.map((inst, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <span className="w-10 text-xs text-slate-500">
                        {idx + 1}/{installments.length}
                      </span>
                      <Input
                        type="date"
                        className="w-40"
                        value={inst.dueDate}
                        onChange={(e) => updateInstallment(idx, { dueDate: e.target.value })}
                      />
                      <Input
                        type="number"
                        step="0.01"
                        min="0.01"
                        className="w-32"
                        value={inst.amount}
                        onChange={(e) =>
                          updateInstallment(idx, { amount: Number(e.target.value) })
                        }
                      />
                      <button
                        type="button"
                        onClick={() => setInstallments(installments.filter((_, i) => i !== idx))}
                        className="text-xs text-red-600 hover:underline"
                      >
                        {t('form.remove')}
                      </button>
                    </div>
                  ))}
                  <p className="text-xs text-slate-500">
                    {t('payment.installmentsSum', {
                      sum: formatMoney(installments.reduce((a, p) => a + p.amount, 0)),
                      total: formatMoney(total),
                    })}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        <div>
          <Label>{tc('notes')}</Label>
          <Textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        <div className="flex items-center justify-between border-t border-slate-200 pt-3 dark:border-slate-700">
          <div className="text-sm">
            {t('th.total')}: <strong className="text-lg">{formatMoney(total)}</strong>
          </div>
          {error && <FieldError>{error}</FieldError>}
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
            {tc('cancel')}
          </Button>
          <Button type="submit" loading={submitting}>
            {initial ? t('form.submitEdit') : t('form.submit')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// =============================================================================
// SERIAL MANAGER — entrada incremental + correção de seriais por linha
// =============================================================================
function SerialManagerModal({
  purchase,
  onClose,
  onChanged,
}: {
  purchase: Purchase;
  onClose: () => void;
  /** Avisa a página pra revalidar a lista (progresso/saldo mudaram). */
  onChanged: () => void;
}) {
  const t = useTranslations('stock.purchases');
  const tc = useTranslations('common');
  const patItems = purchase.items.filter((it) => it.productType === 'PATRIMONIAL');

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={t('serials.title', { invoice: purchase.invoiceNumber ?? '—' })}
    >
      <div className="space-y-4">
        <p className="rounded-md bg-slate-50 p-3 text-xs text-slate-500 dark:bg-slate-900/40 dark:text-slate-400">
          {t('serials.help')}
        </p>

        {patItems.map((it) => (
          <SerialItemPanel
            key={it.id}
            purchaseId={purchase.id}
            item={it}
            onChanged={onChanged}
          />
        ))}

        <div className="flex justify-end pt-2">
          <Button variant="ghost" onClick={onClose}>
            {tc('close')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function SerialItemPanel({
  purchaseId,
  item,
  onChanged,
}: {
  purchaseId: string;
  item: Purchase['items'][number];
  onChanged: () => void;
}) {
  const t = useTranslations('stock.purchases');
  const tc = useTranslations('common');
  const { data, mutate, isLoading } = useSWR<PurchaseItemSerials>(
    stockApi.purchaseItemSerialsPath(purchaseId, item.id),
    () => stockApi.listPurchaseItemSerials(purchaseId, item.id),
  );
  const [batch, setBatch] = useState('');
  const [busy, setBusy] = useState(false);

  const registered = data?.registered ?? item.serials.length;
  const expected = data?.quantity ?? Math.floor(Number(item.quantity));
  const remaining = Math.max(0, expected - registered);
  const complete = remaining === 0;

  async function refresh() {
    await mutate();
    onChanged();
  }

  async function addBatch() {
    const serials = batch
      .split(/[\n,;\t]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (serials.length === 0) return;
    if (serials.length > remaining) {
      toast.error(t('serials.tooMany', { remaining }));
      return;
    }
    setBusy(true);
    try {
      await stockApi.addPurchaseItemSerials(purchaseId, item.id, serials);
      setBatch('');
      await refresh();
      toast.success(t('serials.addedToast', { count: serials.length }));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.friendlyMessage : tc('error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-md border border-slate-200 p-3 dark:border-slate-700">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <strong className="text-sm">{item.productName ?? item.productSku ?? '—'}</strong>
          {item.locationName && (
            <span className="text-xs text-slate-500"> · {item.locationName}</span>
          )}
        </div>
        <span
          className={`text-xs font-medium ${
            complete ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'
          }`}
        >
          {t('serials.progress', { registered, expected })}
        </span>
      </div>

      {!complete && (
        <div className="mt-2">
          <Label className="text-xs">{t('serials.addBatchLabel', { remaining })}</Label>
          <Textarea
            rows={3}
            value={batch}
            onChange={(e) => setBatch(e.target.value)}
            placeholder={t('serials.addBatchPlaceholder')}
            className="font-mono text-xs"
          />
          <div className="mt-1 flex justify-end">
            <Button
              type="button"
              size="sm"
              loading={busy}
              disabled={!batch.trim()}
              onClick={addBatch}
            >
              {t('serials.addButton')}
            </Button>
          </div>
        </div>
      )}

      <div className="mt-2 space-y-1">
        {isLoading && <p className="text-xs text-slate-400">{tc('loading')}</p>}
        {data?.serials.map((s) => (
          <SerialRow
            key={s.id}
            purchaseId={purchaseId}
            itemId={item.id}
            serial={s}
            onMutated={refresh}
          />
        ))}
        {data && data.serials.length === 0 && !isLoading && (
          <p className="text-xs text-slate-400">{t('serials.none')}</p>
        )}
      </div>
    </div>
  );
}

function SerialRow({
  purchaseId,
  itemId,
  serial,
  onMutated,
}: {
  purchaseId: string;
  itemId: string;
  serial: PurchaseItemSerial;
  onMutated: () => Promise<void>;
}) {
  const t = useTranslations('stock.purchases');
  const tc = useTranslations('common');
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(serial.serial);
  const [busy, setBusy] = useState(false);
  // Só dá pra remover do lote se ainda intocado; renomear vale sempre.
  const canRemove = serial.status === 'IN_STOCK' && !serial.contractCode;

  function cancelEdit() {
    setEditing(false);
    setValue(serial.serial);
  }

  async function save() {
    const next = value.trim();
    if (!next || next === serial.serial) return cancelEdit();
    setBusy(true);
    try {
      await stockApi.renameSerial(serial.id, next);
      setEditing(false);
      await onMutated();
      toast.success(t('serials.renamedToast'));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.friendlyMessage : tc('error'));
      setValue(serial.serial);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await stockApi.removePurchaseItemSerial(purchaseId, itemId, serial.id);
      await onMutated();
      toast.success(t('serials.removedToast'));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.friendlyMessage : tc('error'));
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <div className="flex items-center gap-2">
        <Input
          autoFocus
          className="h-7 flex-1 font-mono text-xs"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              return save();
            }
            if (e.key === 'Escape') cancelEdit();
          }}
        />
        <Button type="button" size="sm" loading={busy} onClick={save}>
          {tc('save')}
        </Button>
        <button type="button" className="text-xs text-slate-500 hover:underline" onClick={cancelEdit}>
          {tc('cancel')}
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 border-b border-slate-100 py-1 last:border-0 dark:border-slate-800">
      <span className="flex-1 font-mono text-xs">{serial.serial}</span>
      {serial.status !== 'IN_STOCK' && (
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600 dark:bg-slate-700 dark:text-slate-300">
          {serial.contractCode ? t('serials.inContract', { code: serial.contractCode }) : serial.status}
        </span>
      )}
      <button
        type="button"
        className="text-xs text-sky-600 hover:underline dark:text-sky-400"
        onClick={() => setEditing(true)}
      >
        {tc('edit')}
      </button>
      {canRemove && (
        <button
          type="button"
          disabled={busy}
          className="text-xs text-red-600 hover:underline disabled:opacity-50 dark:text-red-400"
          onClick={remove}
        >
          {t('form.remove')}
        </button>
      )}
    </div>
  );
}
