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
  type CreateAdjustmentInput,
  type CreateStockTransferInput,
  type ListMovementsQuery,
  type MovementType,
  type PaginatedStock,
  type Product,
  type StockLocation,
  type StockMovement,
} from '@/lib/stock-api';

const MOVEMENT_LABELS: Record<MovementType, string> = {
  PURCHASE: 'Compra',
  PURCHASE_RETURN: 'Devolução compra',
  SALE: 'Venda',
  SALE_RETURN: 'Devolução venda',
  COMODATO_OUT: 'Comodato saída',
  COMODATO_RETURN: 'Comodato retorno',
  OS_CONSUMPTION: 'Consumo em OS',
  ADJUSTMENT_IN: 'Ajuste +',
  ADJUSTMENT_OUT: 'Ajuste -',
  TRANSFER_OUT: 'Transferência saída',
  TRANSFER_IN: 'Transferência entrada',
};

const IN_TYPES = new Set<MovementType>([
  'PURCHASE',
  'SALE_RETURN',
  'COMODATO_RETURN',
  'ADJUSTMENT_IN',
  'TRANSFER_IN',
]);

export default function StockMovementsPage() {
  const [filters, setFilters] = useState<ListMovementsQuery>({ page: 1, pageSize: 50 });

  const { data, isLoading, error, mutate } = useSWR<PaginatedStock<StockMovement>>(
    stockApi.movementsPath(filters),
    () => stockApi.listMovements(filters),
  );

  const canAdjust = hasPermission('stock.adjust');
  const canWrite = hasPermission('stock.write');

  const [adjusting, setAdjusting] = useState(false);
  const [transferring, setTransferring] = useState(false);

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Kardex</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Histórico completo de movimentos de estoque (compras, ajustes, transferências,
            consumo). Fonte da verdade pra auditoria.
          </p>
        </div>
        <div className="flex gap-2">
          {canWrite && (
            <Button variant="ghost" onClick={() => setTransferring(true)}>
              Transferir
            </Button>
          )}
          {canAdjust && (
            <Button onClick={() => setAdjusting(true)}>Ajuste de inventário</Button>
          )}
        </div>
      </header>

      <FilterBar filters={filters} onChange={setFilters} />

      {isLoading && <PageLoader />}
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          Falha ao carregar movimentos.
        </div>
      )}

      {data && data.items.length === 0 && (
        <p className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
          Nenhum movimento encontrado pros filtros atuais.
        </p>
      )}

      {data && data.items.length > 0 && (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
              <thead className="bg-slate-50 dark:bg-slate-900/40">
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  <th className="px-4 py-3">Data/hora</th>
                  <th className="px-4 py-3">Tipo</th>
                  <th className="px-4 py-3">Produto</th>
                  <th className="px-4 py-3">Local</th>
                  <th className="px-4 py-3 text-right">Qty</th>
                  <th className="px-4 py-3 text-right">Custo</th>
                  <th className="px-4 py-3">Operador</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {data.items.map((m) => {
                  const isIn = IN_TYPES.has(m.type);
                  return (
                    <tr key={m.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/60">
                      <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300">
                        {new Date(m.createdAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={
                            isIn
                              ? 'inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-800 dark:bg-green-900/30 dark:text-green-300'
                              : 'inline-flex rounded-full bg-orange-100 px-2 py-0.5 text-xs text-orange-800 dark:bg-orange-900/30 dark:text-orange-300'
                          }
                        >
                          {MOVEMENT_LABELS[m.type]}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div>
                          <span className="text-slate-900 dark:text-slate-100">
                            {m.productName ?? m.productId.slice(0, 8)}
                          </span>
                          {m.serial && (
                            <p className="text-xs text-slate-500">SN: {m.serial}</p>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300">
                        {isIn
                          ? m.toLocationName ?? '—'
                          : m.fromLocationName ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className={isIn ? 'text-green-700' : 'text-orange-700'}>
                          {isIn ? '+' : '−'} {m.quantity}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-300">
                        {formatMoney(m.totalCost)}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">{m.createdByName ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <Pagination
            page={data.page}
            pageSize={data.pageSize}
            total={data.total}
            onChange={(page) => setFilters({ ...filters, page })}
          />
        </section>
      )}

      {adjusting && (
        <AdjustmentFormModal
          onClose={() => setAdjusting(false)}
          onSaved={async () => {
            setAdjusting(false);
            await mutate();
          }}
        />
      )}

      {transferring && (
        <TransferFormModal
          onClose={() => setTransferring(false)}
          onSaved={async () => {
            setTransferring(false);
            await mutate();
          }}
        />
      )}
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
// FILTER BAR
// =============================================================================
function FilterBar({
  filters,
  onChange,
}: {
  filters: ListMovementsQuery;
  onChange: (f: ListMovementsQuery) => void;
}) {
  const { data: products } = useSWR<Product[]>(stockApi.productsPath(), () =>
    stockApi.listProducts(),
  );
  const { data: locations } = useSWR<StockLocation[]>(stockApi.locationsPath(), () =>
    stockApi.listLocations(),
  );

  return (
    <div className="flex flex-wrap gap-2">
      <select
        className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
        value={filters.productId ?? ''}
        onChange={(e) =>
          onChange({ ...filters, productId: e.target.value || null, page: 1 })
        }
      >
        <option value="">Todos os produtos</option>
        {products?.map((p) => (
          <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>
        ))}
      </select>

      <select
        className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
        value={filters.locationId ?? ''}
        onChange={(e) =>
          onChange({ ...filters, locationId: e.target.value || null, page: 1 })
        }
      >
        <option value="">Todos os locais</option>
        {locations?.map((l) => (
          <option key={l.id} value={l.id}>{l.code}</option>
        ))}
      </select>

      <select
        className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
        value={filters.type ?? ''}
        onChange={(e) =>
          onChange({ ...filters, type: (e.target.value || null) as MovementType | null, page: 1 })
        }
      >
        <option value="">Todos os tipos</option>
        {Object.entries(MOVEMENT_LABELS).map(([t, label]) => (
          <option key={t} value={t}>{label}</option>
        ))}
      </select>
    </div>
  );
}

// =============================================================================
// PAGINATION
// =============================================================================
function Pagination({
  page,
  pageSize,
  total,
  onChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex items-center justify-between border-t border-slate-200 px-4 py-2 text-xs text-slate-500 dark:border-slate-700">
      <span>
        {total} movimento(s) — página {page} de {totalPages}
      </span>
      <div className="flex gap-1">
        <Button
          variant="ghost"
          size="sm"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
        >
          ←
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => onChange(page + 1)}
        >
          →
        </Button>
      </div>
    </div>
  );
}

// =============================================================================
// ADJUSTMENT FORM (IN/OUT manual)
// =============================================================================
function AdjustmentFormModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
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

  const [form, setForm] = useState<CreateAdjustmentInput>({
    direction: 'IN',
    productId: '',
    locationId: '',
    quantity: 1,
    unitCost: undefined,
    serials: [],
    reason: '',
    notes: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const product = productsById.get(form.productId);
  const isPatrimonial = product?.type === 'PATRIMONIAL';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.productId) return setError('Selecione o produto');
    if (!form.locationId) return setError('Selecione o local');
    if (!form.reason.trim()) return setError('Razão é obrigatória pra auditoria');
    const qty = Number(form.quantity);
    if (!Number.isFinite(qty) || qty <= 0) return setError('Quantidade inválida');
    if (form.direction === 'IN' && (!form.unitCost || Number(form.unitCost) <= 0)) {
      return setError('Custo unitário é obrigatório em entradas (recalcula custo médio)');
    }
    if (isPatrimonial) {
      const serials = (form.serials ?? []).filter(Boolean);
      if (serials.length !== qty) {
        return setError(
          `Patrimonial: precisa de ${qty} serial(is), tem ${serials.length}`,
        );
      }
    }
    setSubmitting(true);
    try {
      await stockApi.createAdjustment({
        ...form,
        quantity: qty,
        unitCost: form.unitCost ? Number(form.unitCost) : undefined,
        serials: isPatrimonial ? (form.serials ?? []).filter(Boolean) : [],
        notes: form.notes || null,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.friendlyMessage : 'Erro ao salvar');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Ajuste de inventário" size="lg">
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label>Direção *</Label>
            <select
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
              value={form.direction}
              onChange={(e) =>
                setForm({ ...form, direction: e.target.value as 'IN' | 'OUT' })
              }
            >
              <option value="IN">Entrada (+) — achado, devolução manual</option>
              <option value="OUT">Saída (−) — perda, dano, descarte</option>
            </select>
          </div>
          <div>
            <Label>Local *</Label>
            <select
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
              value={form.locationId}
              onChange={(e) => setForm({ ...form, locationId: e.target.value })}
              required
            >
              <option value="">—</option>
              {locations?.map((l) => (
                <option key={l.id} value={l.id}>{l.code} — {l.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <Label>Produto *</Label>
          <select
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
            value={form.productId}
            onChange={(e) => setForm({ ...form, productId: e.target.value, serials: [] })}
            required
          >
            <option value="">—</option>
            {products?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.sku} · {p.name} ({p.type === 'PATRIMONIAL' ? 'pat.' : 'cons.'})
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label>Quantidade *</Label>
            <Input
              type="number"
              step="0.0001"
              min="0.0001"
              value={form.quantity}
              onChange={(e) => {
                const qty = e.target.value === '' ? 1 : Number(e.target.value);
                setForm({
                  ...form,
                  quantity: qty,
                  serials: isPatrimonial
                    ? Array.from({ length: Math.max(0, Math.floor(qty)) }, (_, i) =>
                        form.serials?.[i] ?? '',
                      )
                    : [],
                });
              }}
            />
          </div>
          {form.direction === 'IN' && (
            <div>
              <Label>Custo unitário *</Label>
              <Input
                type="number"
                step="0.0001"
                min="0.0001"
                value={form.unitCost ?? ''}
                onChange={(e) =>
                  setForm({
                    ...form,
                    unitCost: e.target.value === '' ? undefined : Number(e.target.value),
                  })
                }
              />
              <p className="text-xs text-slate-500 mt-1">
                Entra no cálculo de custo médio
              </p>
            </div>
          )}
        </div>

        {isPatrimonial && Number(form.quantity) > 0 && (
          <div>
            <Label>Seriais</Label>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {Array.from({ length: Math.floor(Number(form.quantity)) }, (_, sidx) => (
                <Input
                  key={sidx}
                  placeholder={`Serial #${sidx + 1}`}
                  value={form.serials?.[sidx] ?? ''}
                  onChange={(e) => {
                    const next = [...(form.serials ?? [])];
                    next[sidx] = e.target.value;
                    setForm({ ...form, serials: next });
                  }}
                />
              ))}
            </div>
          </div>
        )}

        <div>
          <Label>Razão *</Label>
          <Input
            placeholder="Ex: Contagem cíclica — encontrei +3 unid não registradas"
            value={form.reason}
            onChange={(e) => setForm({ ...form, reason: e.target.value })}
            required
            maxLength={255}
          />
        </div>

        <div>
          <Label>Observações</Label>
          <Textarea
            rows={2}
            value={form.notes ?? ''}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </div>

        {error && <FieldError>{error}</FieldError>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
            Cancelar
          </Button>
          <Button type="submit" loading={submitting}>
            Registrar ajuste
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// =============================================================================
// TRANSFER FORM
// =============================================================================
function TransferFormModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const { data: products } = useSWR<Product[]>(stockApi.productsPath({ isActive: true }), () =>
    stockApi.listProducts({ isActive: true }),
  );
  const { data: locations } = useSWR<StockLocation[]>(stockApi.locationsPath({ isActive: true }), () =>
    stockApi.listLocations({ isActive: true }),
  );

  const [form, setForm] = useState<CreateStockTransferInput>({
    productId: '',
    fromLocationId: '',
    toLocationId: '',
    quantity: 1,
    serialItemIds: [],
    notes: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.productId) return setError('Selecione o produto');
    if (!form.fromLocationId || !form.toLocationId) return setError('Selecione origem e destino');
    if (form.fromLocationId === form.toLocationId)
      return setError('Origem e destino devem ser diferentes');
    setSubmitting(true);
    try {
      await stockApi.createTransfer({
        ...form,
        quantity: Number(form.quantity),
        notes: form.notes || null,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.friendlyMessage : 'Erro ao transferir');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Transferência entre locais" size="lg">
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <Label>Produto *</Label>
          <select
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
            value={form.productId}
            onChange={(e) => setForm({ ...form, productId: e.target.value })}
            required
          >
            <option value="">—</option>
            {products?.map((p) => (
              <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label>De *</Label>
            <select
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
              value={form.fromLocationId}
              onChange={(e) => setForm({ ...form, fromLocationId: e.target.value })}
              required
            >
              <option value="">—</option>
              {locations?.map((l) => (
                <option key={l.id} value={l.id}>{l.code}</option>
              ))}
            </select>
          </div>
          <div>
            <Label>Para *</Label>
            <select
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
              value={form.toLocationId}
              onChange={(e) => setForm({ ...form, toLocationId: e.target.value })}
              required
            >
              <option value="">—</option>
              {locations?.map((l) => (
                <option key={l.id} value={l.id}>{l.code}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <Label>Quantidade *</Label>
          <Input
            type="number"
            step="0.0001"
            min="0.0001"
            value={form.quantity}
            onChange={(e) =>
              setForm({ ...form, quantity: e.target.value === '' ? 1 : Number(e.target.value) })
            }
          />
          <p className="text-xs text-slate-500 mt-1">
            Pra patrimonial, selecione seriais específicos abaixo (UI completa em fase 2).
          </p>
        </div>

        <div>
          <Label>Observações</Label>
          <Textarea
            rows={2}
            value={form.notes ?? ''}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </div>

        {error && <FieldError>{error}</FieldError>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
            Cancelar
          </Button>
          <Button type="submit" loading={submitting}>
            Transferir
          </Button>
        </div>
      </form>
    </Modal>
  );
}
