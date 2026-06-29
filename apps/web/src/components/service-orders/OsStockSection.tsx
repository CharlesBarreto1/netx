'use client';

/**
 * Seção de estoque na página de OS:
 *   1. Lista de materiais consumidos (consumíveis baixados em estoque)
 *   2. Botão "Adicionar consumo" → modal com items dinâmicos (form padrão)
 *   3. Botão "Alocar equipamento ao contrato" → modal de seleção de serial
 *      patrimonial disponível, pré-preenchido com o contractId da OS
 *
 * Permissões:
 *   - Lista: stock.read (qualquer role com leitura de estoque)
 *   - Adicionar consumo: service_orders.write + stock.adjust
 *   - Alocar equipamento: contracts.write + stock.write
 */
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { FieldError, Input, Label, Textarea } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { ApiError } from '@/lib/api';
import { hasPermission } from '@/lib/session';
import {
  stockApi,
  type ComodatoAvailableSerial,
  type OsConsumptionMovement,
  type Product,
  type StockLocation,
} from '@/lib/stock-api';

interface OsStockSectionProps {
  serviceOrderId: string;
  contractId: string;
  isFinalized: boolean; // se OS já foi completed/cancelled, modo read-only
}

export function OsStockSection({
  serviceOrderId,
  contractId,
  isFinalized,
}: OsStockSectionProps) {
  const t = useTranslations('osStock');
  const tCommon = useTranslations('common');

  const canConsume =
    hasPermission('service_orders.write') && hasPermission('stock.adjust');
  const canAllocate =
    hasPermission('contracts.write') && hasPermission('stock.write');

  const { data: consumption, isLoading, error, mutate } = useSWR<
    OsConsumptionMovement[]
  >(stockApi.osConsumptionPath(serviceOrderId), () =>
    stockApi.listOsConsumption(serviceOrderId),
  );

  const [addingConsumption, setAddingConsumption] = useState(false);
  const [allocating, setAllocating] = useState(false);

  if (!hasPermission('stock.read')) return null;

  const totalConsumed = consumption?.reduce(
    (acc, m) => acc + Number(m.totalCost ?? 0),
    0,
  ) ?? 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-text-muted">
          {t('summary.label')}{' '}
          <strong>
            R${' '}
            {totalConsumed.toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </strong>
        </div>
        {!isFinalized && (
          <div className="flex gap-2">
            {canAllocate && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setAllocating(true)}
              >
                {t('actions.addEquipment')}
              </Button>
            )}
            {canConsume && (
              <Button size="sm" onClick={() => setAddingConsumption(true)}>
                {t('actions.addMaterial')}
              </Button>
            )}
          </div>
        )}
      </div>

      {isLoading && <Spinner />}
      {error && (
        <div className="text-sm text-red-600">{t('list.loadError')}</div>
      )}

      {consumption && consumption.length === 0 && (
        <p className="text-sm text-text-muted italic">
          {t('list.empty')}
        </p>
      )}

      {consumption && consumption.length > 0 && (
        <div className="overflow-hidden rounded-md border border-border">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-bg-soft">
              <tr className="text-left text-xs font-semibold uppercase tracking-wide text-text-muted">
                <th className="px-3 py-2">{t('table.product')}</th>
                <th className="px-3 py-2">{t('table.location')}</th>
                <th className="px-3 py-2 text-right">{t('table.quantity')}</th>
                <th className="px-3 py-2 text-right">{t('table.unitCost')}</th>
                <th className="px-3 py-2 text-right">{t('table.total')}</th>
                <th className="px-3 py-2 text-xs">{t('table.when')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {consumption.map((m) => (
                <tr key={m.id} className="hover:bg-bg-soft">
                  <td className="px-3 py-2">
                    <strong>{m.product?.name ?? '—'}</strong>
                    <p className="text-xs text-text-muted font-mono">
                      {m.product?.sku}
                    </p>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {m.fromLocation?.code ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {m.quantity} {m.product?.unit ?? ''}
                  </td>
                  <td className="px-3 py-2 text-right text-text-muted">
                    {formatMoney(m.unitCost)}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold">
                    {formatMoney(m.totalCost)}
                  </td>
                  <td className="px-3 py-2 text-xs text-text-muted">
                    {new Date(m.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {addingConsumption && (
        <AddConsumptionModal
          serviceOrderId={serviceOrderId}
          onClose={() => setAddingConsumption(false)}
          onSaved={async () => {
            setAddingConsumption(false);
            await mutate();
          }}
        />
      )}

      {allocating && (
        <AllocateEquipmentModal
          contractId={contractId}
          onClose={() => setAllocating(false)}
          onSaved={async () => {
            setAllocating(false);
            // Comodato é em outro endpoint, não dá pra mutate aqui — UI do
            // contrato vai mostrar quando user clicar lá.
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
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// =============================================================================
// ADD CONSUMPTION — multi-item form, só consumíveis
// =============================================================================
function AddConsumptionModal({
  serviceOrderId,
  onClose,
  onSaved,
}: {
  serviceOrderId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('osStock');
  const tCommon = useTranslations('common');

  const { data: products } = useSWR<Product[]>(
    stockApi.productsPath({ isActive: true, type: 'CONSUMIVEL' }),
    () => stockApi.listProducts({ isActive: true, type: 'CONSUMIVEL' }),
  );
  const { data: locations } = useSWR<StockLocation[]>(
    stockApi.locationsPath({ isActive: true }),
    () => stockApi.listLocations({ isActive: true }),
  );

  const [items, setItems] = useState<
    Array<{ productId: string; locationId: string; quantity: number; notes: string }>
  >([{ productId: '', locationId: '', quantity: 1, notes: '' }]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateItem(idx: number, patch: Partial<(typeof items)[0]>) {
    const next = [...items];
    next[idx] = { ...next[idx], ...patch };
    setItems(next);
  }

  function addItem() {
    setItems([
      ...items,
      { productId: '', locationId: '', quantity: 1, notes: '' },
    ]);
  }

  function removeItem(idx: number) {
    if (items.length === 1) return;
    setItems(items.filter((_, i) => i !== idx));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it.productId)
        return setError(t('addModal.errors.product', { index: i + 1 }));
      if (!it.locationId)
        return setError(t('addModal.errors.location', { index: i + 1 }));
      const qty = Number(it.quantity);
      if (!Number.isFinite(qty) || qty <= 0)
        return setError(t('addModal.errors.quantity', { index: i + 1 }));
    }
    setSubmitting(true);
    try {
      await stockApi.addOsConsumption(serviceOrderId, {
        items: items.map((it) => ({
          productId: it.productId,
          locationId: it.locationId,
          quantity: Number(it.quantity),
          notes: it.notes || null,
        })),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.friendlyMessage : tCommon('error'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={t('addModal.title')} size="lg">
      <form onSubmit={handleSubmit} className="space-y-3">
        <p className="text-sm text-text-muted">{t('addModal.intro')}</p>

        <div className="space-y-2">
          {items.map((it, idx) => (
            <div
              key={idx}
              className="rounded-md border border-border p-2"
            >
              <div className="grid grid-cols-12 gap-2">
                <div className="col-span-5">
                  <Label className="text-xs">{t('table.product')}</Label>
                  <select
                    className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
                    value={it.productId}
                    onChange={(e) =>
                      updateItem(idx, { productId: e.target.value })
                    }
                  >
                    <option value="">—</option>
                    {products?.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.sku} — {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-span-4">
                  <Label className="text-xs">{t('table.location')}</Label>
                  <select
                    className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
                    value={it.locationId}
                    onChange={(e) =>
                      updateItem(idx, { locationId: e.target.value })
                    }
                  >
                    <option value="">—</option>
                    {locations?.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.code}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-span-2">
                  <Label className="text-xs">{t('table.quantity')}</Label>
                  <Input
                    type="number"
                    step="0.0001"
                    min="0.0001"
                    value={it.quantity}
                    onChange={(e) =>
                      updateItem(idx, {
                        quantity: e.target.value === '' ? 1 : Number(e.target.value),
                      })
                    }
                  />
                </div>
                <div className="col-span-1 flex items-end justify-end">
                  {items.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeItem(idx)}
                      aria-label={t('addModal.removeItem')}
                      className="text-xs text-red-600 hover:underline"
                    >
                      X
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        <Button type="button" variant="ghost" size="sm" onClick={addItem}>
          {t('addModal.addAnotherItem')}
        </Button>

        {error && <FieldError>{error}</FieldError>}

        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={submitting}
          >
            {tCommon('cancel')}
          </Button>
          <Button type="submit" loading={submitting}>
            {t('addModal.submit')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// =============================================================================
// ALLOCATE EQUIPMENT TO CONTRACT — atalho via OS
// =============================================================================
function AllocateEquipmentModal({
  contractId,
  onClose,
  onSaved,
}: {
  contractId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('osStock');
  const tCommon = useTranslations('common');

  const { data: available, isLoading } = useSWR<ComodatoAvailableSerial[]>(
    '/v1/stock/comodato/available',
    () => stockApi.listComodatoAvailable(),
  );

  const [serialItemId, setSerialItemId] = useState('');
  const [notes, setNotes] = useState(t('allocateModal.defaultNotes'));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!serialItemId) return setError(t('allocateModal.errors.required'));
    setSubmitting(true);
    try {
      await stockApi.allocateComodato({
        contractId,
        serialItemId,
        notes: notes || null,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.friendlyMessage : tCommon('error'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={t('allocateModal.title')}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <p className="text-sm text-text-muted">{t('allocateModal.intro')}</p>

        {isLoading && <Spinner />}

        {available && available.length === 0 && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            {t('allocateModal.empty')}
          </div>
        )}

        {available && available.length > 0 && (
          <div>
            <Label>{t('allocateModal.equipmentLabel')}</Label>
            <select
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
              value={serialItemId}
              onChange={(e) => setSerialItemId(e.target.value)}
              required
            >
              <option value="">—</option>
              {available.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.product.sku} · {s.product.name} — SN: {s.serial} (
                  {s.location.code})
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <Label>{tCommon('notes')}</Label>
          <Textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        {error && <FieldError>{error}</FieldError>}

        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={submitting}
          >
            {tCommon('cancel')}
          </Button>
          <Button type="submit" loading={submitting} disabled={!serialItemId}>
            {t('allocateModal.submit')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
