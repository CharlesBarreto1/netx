'use client';

import { useMemo, useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { FieldError, Input, Label, Textarea } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
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

  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState<Purchase | null>(null);

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Compras</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Entradas por compra de fornecedor. Atualiza saldo e recalcula o custo médio
            ponderado de cada produto automaticamente.
          </p>
        </div>
        {canCreate && <Button onClick={() => setCreating(true)}>Nova compra</Button>}
      </header>

      {isLoading && <PageLoader />}
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          Falha ao carregar compras.
        </div>
      )}

      {data && data.length === 0 && (
        <p className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
          Nenhuma compra registrada ainda.
        </p>
      )}

      {data && data.length > 0 && (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
              <thead className="bg-slate-50 dark:bg-slate-900/40">
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  <th className="px-4 py-3">Data</th>
                  <th className="px-4 py-3">Fornecedor</th>
                  <th className="px-4 py-3">Nota fiscal</th>
                  <th className="px-4 py-3 text-right">Itens</th>
                  <th className="px-4 py-3 text-right">Valor total</th>
                  <th className="px-4 py-3">Operador</th>
                  <th className="px-4 py-3 text-right">Ações</th>
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
                      <Button variant="ghost" size="sm" onClick={() => setViewing(p)}>
                        Ver
                      </Button>
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
  return (
    <Modal open onClose={onClose} title={`Compra de ${new Date(purchase.date).toLocaleDateString()}`}>
      <div className="space-y-4">
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs text-slate-500">Fornecedor</dt>
            <dd>{purchase.supplierName ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Nota fiscal</dt>
            <dd className="font-mono">{purchase.invoiceNumber ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Valor total</dt>
            <dd className="font-semibold">{formatMoney(purchase.totalCost)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Registrado por</dt>
            <dd>{purchase.createdByName ?? '—'}</dd>
          </div>
        </dl>

        {purchase.notes && (
          <div className="rounded-md bg-slate-50 p-3 text-sm dark:bg-slate-900/40">
            <p className="text-xs text-slate-500 mb-1">Observações</p>
            <p>{purchase.notes}</p>
          </div>
        )}

        <div>
          <h3 className="text-sm font-semibold mb-2">Itens ({purchase.items.length})</h3>
          <div className="rounded-md border border-slate-200 dark:border-slate-700 overflow-hidden">
            <table className="min-w-full divide-y divide-slate-200 text-xs dark:divide-slate-700">
              <thead className="bg-slate-50 dark:bg-slate-900/40">
                <tr className="text-left">
                  <th className="px-3 py-2">Produto</th>
                  <th className="px-3 py-2">Local</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-3 py-2 text-right">Custo unit.</th>
                  <th className="px-3 py-2 text-right">Total</th>
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
                            Seriais: {it.serials.join(', ')}
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
          <Button variant="ghost" onClick={onClose}>Fechar</Button>
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

    if (!supplierId) return setError('Selecione um fornecedor');
    if (items.length === 0) return setError('Adicione ao menos 1 item');

    // Validação client-side dos serials pra patrimoniais
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it.productId) return setError(`Item ${i + 1}: selecione o produto`);
      if (!it.locationId) return setError(`Item ${i + 1}: selecione o local`);
      const product = productsById.get(it.productId);
      const qty = Number(it.quantity);
      const cost = Number(it.unitCost);
      if (!Number.isFinite(qty) || qty <= 0)
        return setError(`Item ${i + 1}: quantidade inválida`);
      if (!Number.isFinite(cost) || cost <= 0)
        return setError(`Item ${i + 1}: custo unitário inválido`);
      if (product?.type === 'PATRIMONIAL') {
        const serials = it.serials ?? [];
        if (serials.length !== qty) {
          return setError(
            `Item ${i + 1} (${product.name}): patrimonial precisa de exatamente ${qty} serial(is), tem ${serials.length}`,
          );
        }
        if (new Set(serials).size !== serials.length) {
          return setError(`Item ${i + 1}: seriais duplicados no mesmo item`);
        }
      } else {
        if ((it.serials ?? []).length > 0) {
          return setError(
            `Item ${i + 1}: produto consumível não aceita seriais (remova ou troque produto)`,
          );
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
      setError(err instanceof ApiError ? err.friendlyMessage : 'Erro ao salvar');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Nova compra" size="xl">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <div>
            <Label>Fornecedor *</Label>
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
            <Label>Nota fiscal</Label>
            <Input
              value={invoiceNumber}
              onChange={(e) => setInvoiceNumber(e.target.value)}
              placeholder="000123"
            />
          </div>
          <div>
            <Label>Data *</Label>
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
            <h3 className="text-sm font-semibold">Itens</h3>
            <Button type="button" variant="ghost" size="sm" onClick={addItem}>
              + Adicionar item
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
                      <Label className="text-xs">Produto</Label>
                      <select
                        className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
                        value={it.productId}
                        onChange={(e) => updateItem(idx, { productId: e.target.value, serials: [] })}
                      >
                        <option value="">—</option>
                        {products?.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.sku} · {p.name} ({p.type === 'PATRIMONIAL' ? 'pat.' : 'cons.'})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="col-span-3">
                      <Label className="text-xs">Local</Label>
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
                      <Label className="text-xs">Qty</Label>
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
                      <Label className="text-xs">Custo unit.</Label>
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
                          Remover
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Seriais — só pra patrimonial */}
                  {isPatrimonial && Number(it.quantity) > 0 && (
                    <div className="mt-2">
                      <Label className="text-xs">
                        Seriais ({(it.serials ?? []).filter(Boolean).length}/{Number(it.quantity)})
                      </Label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                        {Array.from({ length: Math.floor(Number(it.quantity)) }, (_, sidx) => (
                          <Input
                            key={sidx}
                            placeholder={`Serial #${sidx + 1}`}
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
                    Subtotal: {formatMoney(Number(it.quantity) * Number(it.unitCost))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <Label>Observações</Label>
          <Textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        <div className="flex items-center justify-between border-t border-slate-200 pt-3 dark:border-slate-700">
          <div className="text-sm">
            Total: <strong className="text-lg">{formatMoney(total)}</strong>
          </div>
          {error && <FieldError>{error}</FieldError>}
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
            Cancelar
          </Button>
          <Button type="submit" loading={submitting}>
            Registrar compra
          </Button>
        </div>
      </form>
    </Modal>
  );
}
