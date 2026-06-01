'use client';

import { useTranslations } from 'next-intl';
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

export default function ProductsPage() {
  const t = useTranslations('stock.products');
  const tc = useTranslations('common');
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
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-text-muted">
            {t.rich('subtitle', {
              strong: (chunks) => <strong>{chunks}</strong>,
            })}
          </p>
        </div>
        {canWrite && <Button onClick={() => setCreating(true)}>{t('new')}</Button>}
      </header>

      <div className="flex flex-wrap gap-2">
        <Input
          placeholder={t('searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-md"
        />
        <select
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as ProductType | '')}
        >
          <option value="">{t('allTypes')}</option>
          <option value="PATRIMONIAL">{t('typePatrimonial')}</option>
          <option value="CONSUMIVEL">{t('typeConsumable')}</option>
        </select>
      </div>

      {isLoading && <PageLoader />}
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {t('loadError')}
        </div>
      )}

      {data && data.length === 0 && (
        <p className="rounded-md border border-dashed border-border bg-surface-muted p-6 text-center text-sm text-text-muted">
          {t('empty')}
        </p>
      )}

      {data && data.length > 0 && (
        <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-border text-sm">
              <thead className="bg-surface-muted">
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-text-muted">
                  <th className="px-4 py-3">SKU</th>
                  <th className="px-4 py-3">{t('colProduct')}</th>
                  <th className="px-4 py-3">{tc('type')}</th>
                  <th className="px-4 py-3 text-right">{t('colBalance')}</th>
                  <th className="px-4 py-3 text-right">{t('colAvgCost')}</th>
                  <th className="px-4 py-3 text-right">{t('colPrice')}</th>
                  <th className="px-4 py-3">{tc('status')}</th>
                  {canWrite && <th className="px-4 py-3 text-right">{tc('actions')}</th>}
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
                          {p.type === 'PATRIMONIAL'
                            ? t('typePatrimonial')
                            : t('typeConsumable')}
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
                            {t('onLoan', { n: p.totalAllocated ?? 0 })}
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
                          {p.isActive ? t('active') : t('inactive')}
                        </Badge>
                      </td>
                      {canWrite && (
                        <td className="px-4 py-3 text-right">
                          <Button variant="ghost" size="sm" onClick={() => setEditing(p)}>
                            {tc('edit')}
                          </Button>
                          {canDelete && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setConfirmDelete(p)}
                            >
                              {tc('delete')}
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
          title={t('deleteTitle', { name: confirmDelete.name })}
          message={t('deleteMessage')}
          confirmLabel={tc('delete')}
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
  const t = useTranslations('stock.products');
  const tc = useTranslations('common');
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
    if (!form.sku.trim()) return setError(t('skuRequired'));
    if (!form.name.trim()) return setError(t('nameRequired'));
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
      setError(err instanceof ApiError ? err.friendlyMessage : t('saveError'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={isNew ? t('new') : t('editTitle')}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
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
            <Label htmlFor="name">{tc('name')} *</Label>
            <Input
              id="name"
              placeholder="Router Mikrotik CCR-1009"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <div>
            <Label htmlFor="type">{tc('type')} *</Label>
            <select
              id="type"
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value as ProductType })}
              disabled={!isNew}
            >
              <option value="PATRIMONIAL">{t('typePatrimonialOption')}</option>
              <option value="CONSUMIVEL">{t('typeConsumableOption')}</option>
            </select>
            {!isNew && (
              <p className="text-xs text-text-muted mt-1">{t('typeLocked')}</p>
            )}
          </div>
          <div>
            <Label htmlFor="unit">{t('unit')}</Label>
            <Input
              id="unit"
              placeholder={t('unitPlaceholder')}
              value={form.unit}
              onChange={(e) => setForm({ ...form, unit: e.target.value })}
              maxLength={16}
            />
          </div>
          <div>
            <Label htmlFor="minStock">{t('minStock')}</Label>
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

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label htmlFor="brand">{t('brand')}</Label>
            <Input
              id="brand"
              value={form.brand ?? ''}
              onChange={(e) => setForm({ ...form, brand: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="model">{t('model')}</Label>
            <Input
              id="model"
              value={form.model ?? ''}
              onChange={(e) => setForm({ ...form, model: e.target.value })}
            />
          </div>
        </div>

        <div>
          <Label htmlFor="price">{t('price')}</Label>
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
          <p className="text-xs text-text-muted mt-1">{t('priceHelp')}</p>
        </div>

        <div>
          <Label htmlFor="description">{tc('description')}</Label>
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
          {t('active')}
        </label>

        {error && <FieldError>{error}</FieldError>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
            {tc('cancel')}
          </Button>
          <Button type="submit" loading={submitting}>
            {isNew ? tc('create') : tc('save')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
