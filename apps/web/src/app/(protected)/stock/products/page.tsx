'use client';

import { useState } from 'react';
import useSWR from 'swr';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { FieldError, Input, Label, Textarea } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import { ApiError } from '@/lib/api';
import { hasPermission } from '@/lib/session';
import {
  stockApi,
  type CreateProductInput,
  type Product,
  type ProductType,
} from '@/lib/stock-api';

const PRODUCT_TYPE_LABELS: Record<ProductType, string> = {
  PATRIMONIAL: 'Patrimonial',
  CONSUMIVEL: 'Consumível',
};

export default function ProductsPage() {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<ProductType | ''>('');

  const params = {
    ...(search ? { search } : {}),
    ...(typeFilter ? { type: typeFilter } : {}),
  };
  const { data, isLoading, error, mutate } = useSWR<Product[]>(
    stockApi.productsPath(params),
    () => stockApi.listProducts(params),
  );
  const canWrite = hasPermission('stock.write');
  const canDelete = hasPermission('stock.delete');

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Product | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete(p: Product) {
    setDeleting(true);
    try {
      await stockApi.deleteProduct(p.id);
      await mutate();
    } finally {
      setDeleting(false);
      setConfirmDelete(null);
    }
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Produtos</h1>
          <p className="text-sm text-text-muted">
            Catálogo de produtos. <strong>Patrimonial</strong> rastreia unidade por serial
            (router, ONU); <strong>Consumível</strong> rastreia saldo agregado (cabo,
            conector).
          </p>
        </div>
        {canWrite && <Button onClick={() => setCreating(true)}>Novo produto</Button>}
      </header>

      <div className="flex flex-wrap gap-2">
        <Input
          placeholder="Buscar por SKU, nome, marca, modelo…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-md"
        />
        <select
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as ProductType | '')}
        >
          <option value="">Todos os tipos</option>
          <option value="PATRIMONIAL">Patrimonial</option>
          <option value="CONSUMIVEL">Consumível</option>
        </select>
      </div>

      {isLoading && <PageLoader />}
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          Falha ao carregar produtos.
        </div>
      )}

      {data && data.length === 0 && (
        <p className="rounded-md border border-dashed border-border bg-surface-muted p-6 text-center text-sm text-text-muted">
          Nenhum produto encontrado.
        </p>
      )}

      {data && data.length > 0 && (
        <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-border text-sm">
              <thead className="bg-surface-muted">
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-text-muted">
                  <th className="px-4 py-3">SKU</th>
                  <th className="px-4 py-3">Produto</th>
                  <th className="px-4 py-3">Tipo</th>
                  <th className="px-4 py-3 text-right">Saldo</th>
                  <th className="px-4 py-3 text-right">Custo médio</th>
                  <th className="px-4 py-3 text-right">Preço</th>
                  <th className="px-4 py-3">Status</th>
                  {canWrite && <th className="px-4 py-3 text-right">Ações</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.map((p) => {
                  const totalStock = Number(p.totalStock ?? 0);
                  const minStock = Number(p.minStock ?? 0);
                  const lowStock = minStock > 0 && totalStock < minStock;
                  return (
                    <tr key={p.id} className="hover:bg-surface-hover">
                      <td className="px-4 py-3 font-mono text-xs">{p.sku}</td>
                      <td className="px-4 py-3">
                        <div>
                          <strong className="text-text">{p.name}</strong>
                          {(p.brand || p.model) && (
                            <p className="text-xs text-text-muted">
                              {[p.brand, p.model].filter(Boolean).join(' · ')}
                            </p>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={p.type === 'PATRIMONIAL' ? 'purple' : 'info'}>
                          {PRODUCT_TYPE_LABELS[p.type]}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span
                          className={
                            lowStock
                              ? 'font-semibold text-danger'
                              : 'text-text'
                          }
                        >
                          {totalStock} {p.unit}
                        </span>
                        {p.type === 'PATRIMONIAL' && (p.totalAllocated ?? 0) > 0 && (
                          <p className="text-xs text-text-muted">
                            {p.totalAllocated} em comodato
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-text-muted">
                        {formatMoney(p.cost)}
                      </td>
                      <td className="px-4 py-3 text-right text-text-muted">
                        {p.price ? formatMoney(p.price) : <span className="text-text-subtle">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={p.isActive ? 'success' : 'neutral'}>
                          {p.isActive ? 'Ativo' : 'Inativo'}
                        </Badge>
                      </td>
                      {canWrite && (
                        <td className="px-4 py-3 text-right">
                          <Button variant="ghost" size="sm" onClick={() => setEditing(p)}>
                            Editar
                          </Button>
                          {canDelete && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setConfirmDelete(p)}
                            >
                              Excluir
                            </Button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {(creating || editing) && (
        <ProductFormModal
          initial={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={async () => {
            setCreating(false);
            setEditing(null);
            await mutate();
          }}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          open={true}
          title={`Excluir "${confirmDelete.name}"?`}
          message="Produtos com saldo ou seriais cadastrados não podem ser excluídos — desative no formulário pra ocultar das listagens."
          confirmLabel="Excluir"
          loading={deleting}
          onConfirm={() => handleDelete(confirmDelete)}
          onClose={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

function formatMoney(v: string | number | null): string {
  if (v == null) return '—';
  const n = typeof v === 'string' ? Number(v) : v;
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

// =============================================================================
// FORM MODAL
// =============================================================================
function ProductFormModal({
  initial,
  onClose,
  onSaved,
}: {
  initial: Product | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = !initial;
  const [form, setForm] = useState<CreateProductInput>({
    sku: initial?.sku ?? '',
    name: initial?.name ?? '',
    description: initial?.description ?? '',
    brand: initial?.brand ?? '',
    model: initial?.model ?? '',
    type: initial?.type ?? 'CONSUMIVEL',
    unit: initial?.unit ?? 'un',
    price: initial?.price ? Number(initial.price) : null,
    minStock: initial?.minStock ? Number(initial.minStock) : null,
    isActive: initial?.isActive ?? true,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.sku.trim()) return setError('SKU é obrigatório');
    if (!form.name.trim()) return setError('Nome é obrigatório');
    setSubmitting(true);
    try {
      const payload: CreateProductInput = {
        ...form,
        description: form.description || null,
        brand: form.brand || null,
        model: form.model || null,
        price: form.price ?? null,
        minStock: form.minStock ?? null,
      };
      if (isNew) await stockApi.createProduct(payload);
      else {
        // Type não pode mudar via update
        const { type: _, ...updateData } = payload;
        await stockApi.updateProduct(initial!.id, updateData);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.friendlyMessage : 'Erro ao salvar');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={isNew ? 'Novo produto' : 'Editar produto'}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label htmlFor="sku">SKU *</Label>
            <Input
              id="sku"
              placeholder="RTR-MK-CCR1009"
              value={form.sku}
              onChange={(e) => setForm({ ...form, sku: e.target.value })}
              required
              maxLength={64}
            />
          </div>
          <div className="col-span-2">
            <Label htmlFor="name">Nome *</Label>
            <Input
              id="name"
              placeholder="Router Mikrotik CCR-1009"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label htmlFor="type">Tipo *</Label>
            <select
              id="type"
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value as ProductType })}
              disabled={!isNew}
            >
              <option value="PATRIMONIAL">Patrimonial (com serial)</option>
              <option value="CONSUMIVEL">Consumível (qty)</option>
            </select>
            {!isNew && (
              <p className="text-xs text-text-muted mt-1">Tipo não pode mudar após criação</p>
            )}
          </div>
          <div>
            <Label htmlFor="unit">Unidade</Label>
            <Input
              id="unit"
              placeholder="un, m, kg, pç…"
              value={form.unit}
              onChange={(e) => setForm({ ...form, unit: e.target.value })}
              maxLength={16}
            />
          </div>
          <div>
            <Label htmlFor="minStock">Estoque mínimo</Label>
            <Input
              id="minStock"
              type="number"
              step="0.0001"
              min="0"
              value={form.minStock ?? ''}
              onChange={(e) =>
                setForm({
                  ...form,
                  minStock: e.target.value === '' ? null : Number(e.target.value),
                })
              }
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="brand">Marca</Label>
            <Input
              id="brand"
              value={form.brand ?? ''}
              onChange={(e) => setForm({ ...form, brand: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="model">Modelo</Label>
            <Input
              id="model"
              value={form.model ?? ''}
              onChange={(e) => setForm({ ...form, model: e.target.value })}
            />
          </div>
        </div>

        <div>
          <Label htmlFor="price">Preço sugerido (venda)</Label>
          <Input
            id="price"
            type="number"
            step="0.0001"
            min="0"
            value={form.price ?? ''}
            onChange={(e) =>
              setForm({
                ...form,
                price: e.target.value === '' ? null : Number(e.target.value),
              })
            }
          />
          <p className="text-xs text-text-muted mt-1">
            Consultivo — venda real pode override. Custo médio é recalculado automaticamente nas compras.
          </p>
        </div>

        <div>
          <Label htmlFor="description">Descrição</Label>
          <Textarea
            id="description"
            rows={2}
            value={form.description ?? ''}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.isActive ?? true}
            onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
          />
          Ativo
        </label>

        {error && <FieldError>{error}</FieldError>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
            Cancelar
          </Button>
          <Button type="submit" loading={submitting}>
            {isNew ? 'Criar' : 'Salvar'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
