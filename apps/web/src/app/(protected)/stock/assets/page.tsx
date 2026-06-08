'use client';

/**
 * /stock/assets — Gestão de patrimônios (SerialItem).
 *
 * Lista todos os equipamentos com serial, busca por serial, e permite mudar o
 * status: defeito / baixada / vendida / inutilizada (descontabilizam do estoque
 * mas mantêm o registro) ou voltar ao estoque (reativar). Item em comodato com
 * cliente é bloqueado — devolver o comodato primeiro.
 */
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import useSWR from 'swr';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input, Label, Select, Textarea } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import { ApiError } from '@/lib/api';
import { hasPermission } from '@/lib/session';
import {
  stockApi,
  type ChangeSerialStatusInput,
  type PaginatedData,
  type SerialItem,
  type SerialStatus,
  type SerialStatusTarget,
  type StockLocation,
} from '@/lib/stock-api';

const STATUS_TONE: Record<SerialStatus, 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'brand' | 'purple'> = {
  IN_STOCK: 'success',
  ALLOCATED: 'info',
  IN_TRANSIT: 'warning',
  DEFECTIVE: 'warning',
  WRITTEN_OFF: 'neutral',
  SOLD: 'purple',
  DISCARDED: 'danger',
};

const TARGET_STATUSES: SerialStatusTarget[] = [
  'DEFECTIVE',
  'WRITTEN_OFF',
  'SOLD',
  'DISCARDED',
  'IN_STOCK',
];

export default function StockAssetsPage() {
  const t = useTranslations('stock.assets');
  const tc = useTranslations('common');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<SerialStatus | ''>('');
  const [page, setPage] = useState(1);

  const params = {
    page,
    pageSize: 50,
    ...(search.trim() ? { search: search.trim() } : {}),
    ...(statusFilter ? { status: statusFilter } : {}),
  };
  const { data, isLoading, mutate } = useSWR<PaginatedData<SerialItem>>(
    stockApi.serialItemsPath(params),
    () => stockApi.listSerialItems(params),
  );
  const canAdjust = hasPermission('stock.adjust');
  const [editing, setEditing] = useState<SerialItem | null>(null);

  const statusLabel = (s: SerialStatus) => t(`status.${s}`);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">{t('subtitle')}</p>
      </header>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Label htmlFor="search">{t('searchLabel')}</Label>
          <Input
            id="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder={t('searchPlaceholder')}
          />
        </div>
        <div className="sm:w-56">
          <Label htmlFor="status">{t('filterStatus')}</Label>
          <Select
            id="status"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as SerialStatus | '');
              setPage(1);
            }}
          >
            <option value="">{t('allStatuses')}</option>
            {(Object.keys(STATUS_TONE) as SerialStatus[]).map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {isLoading && !data ? (
        <PageLoader />
      ) : (
        <div className="overflow-x-auto rounded-md border border-border bg-surface">
          <table className="min-w-full text-sm">
            <thead className="bg-surface-muted text-left text-[11px] font-semibold uppercase tracking-wider text-text-muted">
              <tr>
                <th className="px-3 py-2">{t('colSerial')}</th>
                <th className="px-3 py-2">{t('colProduct')}</th>
                <th className="px-3 py-2">{t('colStatus')}</th>
                <th className="px-3 py-2">{t('colLocation')}</th>
                <th className="px-3 py-2">{t('colContract')}</th>
                {canAdjust && <th className="px-3 py-2"></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(data?.data ?? []).length === 0 ? (
                <tr>
                  <td colSpan={canAdjust ? 6 : 5} className="px-3 py-6 text-center text-text-muted">
                    {tc('nothingHere')}
                  </td>
                </tr>
              ) : (
                (data?.data ?? []).map((it) => (
                  <tr key={it.id}>
                    <td className="px-3 py-2 font-mono">{it.serial}</td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{it.product.name}</div>
                      <div className="text-xs text-text-muted">{it.product.sku}</div>
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={STATUS_TONE[it.status]}>{statusLabel(it.status)}</Badge>
                    </td>
                    <td className="px-3 py-2 text-text-muted">{it.location?.name ?? '—'}</td>
                    <td className="px-3 py-2 text-text-muted">{it.contract?.code ?? '—'}</td>
                    {canAdjust && (
                      <td className="px-3 py-2 text-right">
                        <Button size="sm" variant="ghost" onClick={() => setEditing(it)}>
                          {t('changeStatus')}
                        </Button>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {data && data.pagination.totalPages > 1 && (
        <div className="flex items-center justify-end gap-2 text-xs text-text-muted">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            {tc('previous')}
          </Button>
          <span>
            {page} / {data.pagination.totalPages}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={page >= data.pagination.totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            {tc('next')}
          </Button>
        </div>
      )}

      {editing && (
        <ChangeStatusModal
          item={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await mutate();
          }}
        />
      )}
    </div>
  );
}

function ChangeStatusModal({
  item,
  onClose,
  onSaved,
}: {
  item: SerialItem;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const t = useTranslations('stock.assets');
  const tc = useTranslations('common');
  const [target, setTarget] = useState<SerialStatusTarget>('DEFECTIVE');
  const [reason, setReason] = useState('');
  const [locationId, setLocationId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Locais só pra reativação (voltar ao estoque).
  const { data: locations } = useSWR<StockLocation[]>(
    target === 'IN_STOCK' ? stockApi.locationsPath({ isActive: true }) : null,
    () => stockApi.listLocations({ isActive: true }),
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const input: ChangeSerialStatusInput = {
        status: target,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
        ...(target === 'IN_STOCK' ? { locationId } : {}),
      };
      await stockApi.changeSerialStatus(item.id, input);
      toast.success(tc('success'));
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.friendlyMessage : (err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={t('modalTitle')}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="rounded-md border border-border bg-surface-muted p-3 text-sm">
          <div className="font-mono font-medium">{item.serial}</div>
          <div className="text-xs text-text-muted">
            {item.product.name} · {t(`status.${item.status}`)}
          </div>
        </div>

        <div>
          <Label htmlFor="target" required>
            {t('newStatus')}
          </Label>
          <Select
            id="target"
            value={target}
            onChange={(e) => setTarget(e.target.value as SerialStatusTarget)}
          >
            {TARGET_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`target.${s}`)}
              </option>
            ))}
          </Select>
        </div>

        {target === 'IN_STOCK' && (
          <div>
            <Label htmlFor="loc" required>
              {t('targetLocation')}
            </Label>
            <Select id="loc" value={locationId} onChange={(e) => setLocationId(e.target.value)} required>
              <option value="">{tc('select')}</option>
              {(locations ?? []).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </div>
        )}

        <div>
          <Label htmlFor="reason">{t('reason')}</Label>
          <Textarea
            id="reason"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('reasonPlaceholder')}
          />
        </div>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            {tc('cancel')}
          </Button>
          <Button type="submit" loading={saving} disabled={target === 'IN_STOCK' && !locationId}>
            {tc('save')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
