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
import { hasPermission } from '@/lib/session';
import {
  stockApi,
  type CreatePurchaseInput,
  type Product,
  type Purchase,
  type PurchaseItemInput,
  type StockLocation,
  type Supplier,
} from '@/lib/stock-api';

export default function PurchasesPage() {
  const { data, isLoading, error, mutate } = useSWR<Purchase[]>(
    stockApi.purchasesPath(),
    () => stockApi.listPurchases(),
  );
  const canCreate = hasPermission('stock.purchase.create');
  const canDelete = hasPermission('stock.purchase.delete');
  const t = useTranslations('stock.purchases');
  const tc = useTranslations('common');

  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState<Purchase | null>(null);
  const [deleting, setDeleting] = useState<Purchase | null>(null);
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
                    <td className="px-4 py-3 text-right">{p.items.length}</td>
                    <td className="px-4 py-3 text-right">{formatMoney(p.totalCost)}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{p.createdByName ?? '—'}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setViewing(p)}>
                          {t('view')}
                        </Button>
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

      {viewing && <PurchaseDetailsModal purchase={viewing} onClose={() => setViewing(null)} />}

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
            <dd>{purchase.createdByName ?? '—'}</dd>
          </div>
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
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('stock.purchases');
  const tc = useTranslations('common');
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

  const [supplierId, setSupplierId] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<PurchaseItemInput[]>([
    { productId: '', locationId: '', quantity: 1, unitCost: 0, serials: [] },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        const serials = it.serials ?? [];
        if (serials.length !== qty) {
          return setError(
            t('errors.serialsCount', { n: i + 1, product: product.name, expected: qty, got: serials.length }),
          );
        }
        if (new Set(serials).size !== serials.length) {
          return setError(t('errors.serialsDuplicate', { n: i + 1 }));
        }
      } else {
        if ((it.serials ?? []).length > 0) {
          return setError(t('errors.serialsNotAllowed', { n: i + 1 }));
        }
      }
    }

    setSubmitting(true);
    try {
      const payload: CreatePurchaseInput = {
        supplierId,
        invoiceNumber: invoiceNumber || null,
        date,
        notes: notes || null,
        items: items.map((it) => ({
          ...it,
          quantity: Number(it.quantity),
          unitCost: Number(it.unitCost),
          serials: it.serials ?? [],
        })),
      };
      await stockApi.createPurchase(payload);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.friendlyMessage : t('errors.saveFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={t('new')} size="xl">
      <form onSubmit={handleSubmit} className="space-y-4">
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
                          updateItem(idx, {
                            quantity: e.target.value === '' ? 1 : qty,
                            // Pra patrimonial, garante array de seriais com tamanho == qty
                            serials: isPatrimonial
                              ? Array.from(
                                  { length: Math.max(0, Math.floor(qty)) },
                                  (_, i) => it.serials?.[i] ?? '',
                                )
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

                  {/* Seriais — só pra patrimonial */}
                  {isPatrimonial && Number(it.quantity) > 0 && (
                    <div className="mt-2">
                      <Label className="text-xs">
                        {t('form.serials', { filled: (it.serials ?? []).filter(Boolean).length, total: Number(it.quantity) })}
                      </Label>
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
            {t('form.submit')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
