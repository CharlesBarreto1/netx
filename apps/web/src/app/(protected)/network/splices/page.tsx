'use client';

/**
 * /network/splices — fusões/emendas de fibra (R4 OSP).
 *
 * Cada linha = uma fusão entre fibra X do cabo A e fibra Y do cabo B.
 * Cores TIA-598 viram chips visuais — técnico identifica de relance.
 * Loss dB colorido por classe (verde<0.2 / amarelo<0.5 / vermelho).
 * Foto opcional via URL (upload integrado é futuro StorageModule).
 */
import dynamic from 'next/dynamic';
import { Plus, Pencil, Trash2, ImageIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import useSWR from 'swr';

import { FiberChip, FiberPicker } from '@/components/optical/FiberPicker';
import type { LatLng } from '@/components/mapping/LocationPicker';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import {
  FieldHelp,
  Input,
  Label,
  Select,
  Textarea,
} from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api';
import type { Paginated } from '@/lib/crm-types';
import {
  fiberCablesApi,
  fiberSplicesApi,
  type CreateFiberSpliceInput,
  type FiberCable,
  type FiberSplice,
  type FiberSpliceLossClass,
} from '@/lib/fiber-api';
import { hasPermission } from '@/lib/session';

const LocationPicker = dynamic(
  () =>
    import('@/components/mapping/LocationPicker').then((m) => m.LocationPicker),
  {
    ssr: false,
    loading: () => (
      <div className="h-[320px] animate-pulse rounded-md bg-surface-muted" />
    ),
  },
);

const LOSS_TONE: Record<
  FiberSpliceLossClass,
  'neutral' | 'success' | 'warning' | 'danger'
> = {
  unmeasured: 'neutral',
  good: 'success',
  warning: 'warning',
  bad: 'danger',
};

const LOSS_LABEL_KEY: Record<FiberSpliceLossClass, string> = {
  unmeasured: 'lossUnmeasured',
  good: 'lossGood',
  warning: 'lossWarning',
  bad: 'lossBad',
};

export default function FiberSplicesPage() {
  const t = useTranslations('network.splices');
  const tc = useTranslations('common');
  const canWrite = hasPermission('network.write');
  const canDelete = hasPermission('network.delete');

  const [cableFilter, setCableFilter] = useState<string>('');
  const [page, setPage] = useState(1);
  const pageSize = 50;

  // Lista de cabos pra Select de filtro + Select dos forms.
  const { data: cablesResp } = useSWR<Paginated<FiberCable>>(
    fiberCablesApi.listPath({ pageSize: 500 }),
  );
  const cables = useMemo(() => cablesResp?.data ?? [], [cablesResp]);

  const key = fiberSplicesApi.listPath({
    page,
    pageSize,
    cableId: cableFilter || undefined,
  });
  const { data, isLoading, mutate } = useSWR<Paginated<FiberSplice>>(key);

  const [editing, setEditing] = useState<FiberSplice | 'new' | null>(null);
  const [deleting, setDeleting] = useState<FiberSplice | null>(null);
  const [viewingPhoto, setViewingPhoto] = useState<FiberSplice | null>(null);

  if (isLoading && !data) return <PageLoader label={t('loadingSplices')} />;

  const rows = data?.data ?? [];

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-text-muted">{t('subtitle')}</p>
        </div>
        {canWrite && (
          <Button
            onClick={() => setEditing('new')}
            disabled={cables.length < 1}
          >
            <Plus className="h-3.5 w-3.5" />
            {t('newSplice')}
          </Button>
        )}
      </header>

      {cables.length === 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          {t.rich('noCablesWarning', {
            strong: (chunks) => <strong>{chunks}</strong>,
            link: (chunks) => (
              <a href="/network/fiber" className="underline">
                {chunks}
              </a>
            ),
          })}
        </div>
      )}

      {/* Filtros */}
      <section className="grid grid-cols-1 gap-3 rounded-md border border-border bg-surface p-4 md:grid-cols-3">
        <div className="md:col-span-2">
          <Label htmlFor="sp-cable">{t('filterCableLabel')}</Label>
          <Select
            id="sp-cable"
            value={cableFilter}
            onChange={(e) => {
              setCableFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="">{t('allCables')}</option>
            {cables.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} ({c.type} · {t('fibersCount', { count: c.fiberCount })})
              </option>
            ))}
          </Select>
        </div>
        <div className="flex items-end justify-end">
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setCableFilter('');
              setPage(1);
            }}
          >
            {tc('clear')}
          </Button>
        </div>
      </section>

      {/* Lista */}
      <div className="overflow-x-auto rounded-md border border-border bg-surface">
        <table className="min-w-full text-sm">
          <thead className="bg-surface-muted text-left text-[11px] font-semibold uppercase tracking-wider text-text-muted">
            <tr>
              <th className="px-3 py-2">{t('colCableAFiber')}</th>
              <th className="px-3 py-2">↔</th>
              <th className="px-3 py-2">{t('colCableBFiber')}</th>
              <th className="px-3 py-2">{t('colLoss')}</th>
              <th className="px-3 py-2">{t('colState')}</th>
              <th className="px-3 py-2">{t('colMeasured')}</th>
              <th className="px-3 py-2">{t('colPhoto')}</th>
              <th className="px-3 py-2 text-right">{tc('actions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-text-muted">
                  {t('empty')}
                </td>
              </tr>
            ) : (
              rows.map((s) => (
                <tr key={s.id} className="hover:bg-surface-hover">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-text">
                        {s.cableA.code}
                      </span>
                      <FiberChip index={s.fiberAIndex} showName={false} />
                    </div>
                  </td>
                  <td className="px-3 py-2 text-text-muted">↔</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-text">
                        {s.cableB.code}
                      </span>
                      <FiberChip index={s.fiberBIndex} showName={false} />
                    </div>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {s.lossDb != null ? `${s.lossDb.toFixed(2)} dB` : '—'}
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={LOSS_TONE[s.lossClass]}>
                      {t(LOSS_LABEL_KEY[s.lossClass])}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-xs text-text-muted">
                    {s.measuredAt ? (
                      <>
                        {new Date(s.measuredAt).toLocaleDateString('pt-BR')}
                        {s.measuredBy && (
                          <div className="text-text-subtle">
                            {s.measuredBy.firstName} {s.measuredBy.lastName}
                          </div>
                        )}
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {s.photoUrl ? (
                      <button
                        onClick={() => setViewingPhoto(s)}
                        title={t('viewPhoto')}
                        className="text-brand-600 hover:text-brand-700"
                      >
                        <ImageIcon className="h-4 w-4" />
                      </button>
                    ) : (
                      <span className="text-text-subtle">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      {canWrite && (
                        <button
                          onClick={() => setEditing(s)}
                          title={tc('edit')}
                          className="p-1 text-text-muted hover:text-text"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                      )}
                      {canDelete && (
                        <button
                          onClick={() => setDeleting(s)}
                          title={tc('delete')}
                          className="p-1 text-text-muted hover:text-red-600"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {data && data.pagination.totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-text-muted">
          <span>
            {tc('page')} {data.pagination.page} {tc('of')}{' '}
            {data.pagination.totalPages}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              {tc('previous')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= data.pagination.totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              {tc('next')}
            </Button>
          </div>
        </div>
      )}

      {editing && (
        <SpliceFormDialog
          initial={editing === 'new' ? null : editing}
          cables={cables}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            await mutate();
            setEditing(null);
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          open
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            try {
              await fiberSplicesApi.remove(deleting.id);
              toast.success(t('toastDeleted'));
              await mutate();
              setDeleting(null);
            } catch (err) {
              toast.error(
                err instanceof ApiError ? err.friendlyMessage : tc('error'),
              );
            }
          }}
          title={t('deleteConfirmTitle')}
          message={t('deleteConfirmMessage')}
          confirmLabel={tc('delete')}
          variant="danger"
        />
      )}

      {viewingPhoto && viewingPhoto.photoUrl && (
        <Modal
          open
          onClose={() => setViewingPhoto(null)}
          title={t('photoModalTitle', {
            cableA: viewingPhoto.cableA.code,
            fiberA: viewingPhoto.fiberAIndex,
            cableB: viewingPhoto.cableB.code,
            fiberB: viewingPhoto.fiberBIndex,
          })}
          size="lg"
        >
          <img
            src={viewingPhoto.photoUrl}
            alt={t('photoAlt')}
            className="w-full rounded-md"
          />
        </Modal>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Form: criar / editar fusão
// ───────────────────────────────────────────────────────────────────────────
function SpliceFormDialog({
  initial,
  cables,
  onClose,
  onSaved,
}: {
  initial: FiberSplice | null;
  cables: FiberCable[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('network.splices');
  const tc = useTranslations('common');
  const isNew = !initial;
  const [cableAId, setCableAId] = useState(initial?.cableAId ?? cables[0]?.id ?? '');
  const [fiberAIndex, setFiberAIndex] = useState(initial?.fiberAIndex ?? 1);
  const [cableBId, setCableBId] = useState(initial?.cableBId ?? cables[0]?.id ?? '');
  const [fiberBIndex, setFiberBIndex] = useState(initial?.fiberBIndex ?? 2);
  const [location, setLocation] = useState<LatLng | null>(
    initial
      ? { latitude: initial.latitude, longitude: initial.longitude }
      : null,
  );
  const [lossDb, setLossDb] = useState<string>(
    initial?.lossDb != null ? String(initial.lossDb) : '0.10',
  );
  const [lossMeasured, setLossMeasured] = useState<boolean>(
    initial?.lossDb != null,
  );
  const [photoUrl, setPhotoUrl] = useState(initial?.photoUrl ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cableA = cables.find((c) => c.id === cableAId);
  const cableB = cables.find((c) => c.id === cableBId);

  // Quando cabo muda, clampa a fibra se >= fiberCount do novo cabo.
  function pickCableA(id: string) {
    setCableAId(id);
    const c = cables.find((x) => x.id === id);
    if (c && fiberAIndex > c.fiberCount) setFiberAIndex(1);
  }
  function pickCableB(id: string) {
    setCableBId(id);
    const c = cables.find((x) => x.id === id);
    if (c && fiberBIndex > c.fiberCount) setFiberBIndex(1);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!cableAId || !cableBId)
      return setError(t('errChooseCables'));
    if (!location)
      return setError(t('errMarkLocation'));
    if (cableAId === cableBId && fiberAIndex === fiberBIndex)
      return setError(t('errSameFiber'));
    setSubmitting(true);
    try {
      const payload: CreateFiberSpliceInput = {
        latitude: location.latitude,
        longitude: location.longitude,
        cableAId,
        fiberAIndex,
        cableBId,
        fiberBIndex,
        lossDb: lossMeasured ? Number(lossDb) : null,
        photoUrl: photoUrl || null,
        measuredAt: lossMeasured ? new Date().toISOString() : null,
        notes: notes || null,
      };
      if (isNew) {
        await fiberSplicesApi.create(payload);
      } else {
        await fiberSplicesApi.update(initial!.id, payload);
      }
      toast.success(isNew ? t('toastCreated') : t('toastUpdated'));
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.friendlyMessage : tc('error'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? t('newSplice') : t('editSplice')}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            {tc('cancel')}
          </Button>
          <Button onClick={handleSubmit} loading={submitting}>
            {tc('save')}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          {/* Lado A */}
          <div className="space-y-2 rounded-md border border-border bg-surface-muted p-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-text-muted">
              {t('cableA')}
            </div>
            <div>
              <Label htmlFor="sp-cable-a" required>
                {t('cable')}
              </Label>
              <Select
                id="sp-cable-a"
                value={cableAId}
                onChange={(e) => pickCableA(e.target.value)}
              >
                <option value="">—</option>
                {cables.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} ({t('fiberCountShort', { count: c.fiberCount })})
                  </option>
                ))}
              </Select>
            </div>
            {cableA && (
              <div>
                <Label htmlFor="sp-fiber-a" required>
                  {t('fiber')}
                </Label>
                <FiberPicker
                  id="sp-fiber-a"
                  value={fiberAIndex}
                  onChange={setFiberAIndex}
                  fiberCount={cableA.fiberCount}
                />
              </div>
            )}
          </div>

          {/* Lado B */}
          <div className="space-y-2 rounded-md border border-border bg-surface-muted p-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-text-muted">
              {t('cableB')}
            </div>
            <div>
              <Label htmlFor="sp-cable-b" required>
                {t('cable')}
              </Label>
              <Select
                id="sp-cable-b"
                value={cableBId}
                onChange={(e) => pickCableB(e.target.value)}
              >
                <option value="">—</option>
                {cables.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} ({t('fiberCountShort', { count: c.fiberCount })})
                  </option>
                ))}
              </Select>
            </div>
            {cableB && (
              <div>
                <Label htmlFor="sp-fiber-b" required>
                  {t('fiber')}
                </Label>
                <FiberPicker
                  id="sp-fiber-b"
                  value={fiberBIndex}
                  onChange={setFiberBIndex}
                  fiberCount={cableB.fiberCount}
                />
              </div>
            )}
          </div>
        </div>

        <div>
          <Label required>{t('locationLabel')}</Label>
          <FieldHelp>{t('locationHelp')}</FieldHelp>
          <LocationPicker value={location} onChange={setLocation} />
        </div>

        <div className="rounded-md border border-border p-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={lossMeasured}
              onChange={(e) => setLossMeasured(e.target.checked)}
            />
            {t('lossMeasuredLabel')}
          </label>
          {lossMeasured && (
            <div className="mt-2 flex items-center gap-2">
              <Input
                type="number"
                min={0}
                max={99.99}
                step={0.01}
                value={lossDb}
                onChange={(e) => setLossDb(e.target.value)}
                className="max-w-[140px]"
              />
              <span className="text-xs text-text-muted">dB</span>
              <FieldHelp>{t('lossHelp')}</FieldHelp>
            </div>
          )}
        </div>

        <div>
          <Label htmlFor="sp-photo">{t('photoUrlLabel')}</Label>
          <Input
            id="sp-photo"
            type="url"
            value={photoUrl}
            onChange={(e) => setPhotoUrl(e.target.value)}
            placeholder="https://…"
          />
          <FieldHelp>{t('photoUrlHelp')}</FieldHelp>
        </div>

        <div>
          <Label>{tc('notes')}</Label>
          <Textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t('notesPlaceholder')}
          />
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}
      </form>
    </Modal>
  );
}
