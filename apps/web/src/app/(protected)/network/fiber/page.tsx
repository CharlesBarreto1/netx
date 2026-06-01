'use client';

/**
 * /network/fiber — CRUD de cabos de fibra (R3 OSP).
 *
 * Lista com filtros (tipo, busca por código) + dialog de criar/editar com
 * PolylineEditor pra desenhar o caminho no mapa. Cálculo de comprimento
 * automático via Haversine no backend; operador pode override.
 *
 * Pré-requisito de R4 (fusões), R5 (power budget) e R6 (OTDR).
 */
import dynamic from 'next/dynamic';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import useSWR from 'swr';

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
  COMMON_FIBER_COUNTS,
  fiberCablesApi,
  type CreateFiberCableInput,
  type FiberCable,
  type FiberCableType,
  type PathPoint,
} from '@/lib/fiber-api';
import {
  opticalApi,
  type OpticalEnclosure,
} from '@/lib/optical-api';
import { hasPermission } from '@/lib/session';

const PolylineEditor = dynamic(
  () =>
    import('@/components/mapping/PolylineEditor').then(
      (m) => m.PolylineEditor,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="h-[360px] animate-pulse rounded-md bg-surface-muted" />
    ),
  },
);

const TYPE_LABEL_KEY: Record<FiberCableType, string> = {
  BACKBONE: 'typeBackbone',
  DISTRIBUTION: 'typeDistribution',
  DROP: 'typeDrop',
};

const TYPE_TONE: Record<
  FiberCableType,
  'info' | 'brand' | 'success'
> = {
  BACKBONE: 'info',
  DISTRIBUTION: 'brand',
  DROP: 'success',
};

function formatLength(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`;
  return `${meters.toFixed(0)} m`;
}

export default function FiberCablesPage() {
  const t = useTranslations('network.fiber');
  const tc = useTranslations('common');
  const canWrite = hasPermission('network.write');
  const canDelete = hasPermission('network.delete');

  const [search, setSearch] = useState('');
  const [type, setType] = useState<FiberCableType | ''>('');
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const key = fiberCablesApi.listPath({
    page,
    pageSize,
    type: type || undefined,
    search: search || undefined,
  });
  const { data, isLoading, mutate } = useSWR<Paginated<FiberCable>>(key);

  const [editing, setEditing] = useState<FiberCable | 'new' | null>(null);
  const [deleting, setDeleting] = useState<FiberCable | null>(null);

  if (isLoading && !data) return <PageLoader label={t('loadingCables')} />;

  const rows = data?.data ?? [];

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-text-muted">{t('subtitle')}</p>
        </div>
        {canWrite && (
          <Button onClick={() => setEditing('new')}>
            <Plus className="h-3.5 w-3.5" />
            {t('newCable')}
          </Button>
        )}
      </header>

      {/* Filtros */}
      <section className="grid grid-cols-1 gap-3 rounded-md border border-border bg-surface p-4 md:grid-cols-4">
        <div className="md:col-span-2">
          <Label htmlFor="cab-search">{tc('search')}</Label>
          <Input
            id="cab-search"
            placeholder={t('searchPlaceholder')}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div>
          <Label htmlFor="cab-type">{tc('type')}</Label>
          <Select
            id="cab-type"
            value={type}
            onChange={(e) => {
              setType(e.target.value as FiberCableType | '');
              setPage(1);
            }}
          >
            <option value="">{tc('all')}</option>
            <option value="BACKBONE">{t('typeBackbone')}</option>
            <option value="DISTRIBUTION">{t('typeDistribution')}</option>
            <option value="DROP">{t('typeDrop')}</option>
          </Select>
        </div>
        <div className="flex items-end justify-end">
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setSearch('');
              setType('');
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
              <th className="px-3 py-2">{tc('code')}</th>
              <th className="px-3 py-2">{tc('type')}</th>
              <th className="px-3 py-2">{t('fibers')}</th>
              <th className="px-3 py-2">{t('length')}</th>
              <th className="px-3 py-2">{t('points')}</th>
              <th className="px-3 py-2">{tc('status')}</th>
              <th className="px-3 py-2 text-right">{tc('actions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-text-muted">
                  {t('empty')}
                </td>
              </tr>
            ) : (
              rows.map((c) => (
                <tr key={c.id} className="hover:bg-surface-hover">
                  <td className="px-3 py-2 font-medium text-text">{c.code}</td>
                  <td className="px-3 py-2">
                    <Badge tone={TYPE_TONE[c.type]}>
                      {t(TYPE_LABEL_KEY[c.type])}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-text-muted">{c.fiberCount}</td>
                  <td className="px-3 py-2 text-text-muted">
                    {formatLength(c.lengthMeters)}
                    {c.lengthOverridden && (
                      <span
                        title={t('lengthOverriddenTooltip')}
                        className="ml-1 text-xs text-amber-600"
                      >
                        ✎
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-text-muted text-xs">
                    <div>{t('vertices', { count: c.path.length })}</div>
                    <div className="text-text-subtle">
                      {c.endpointA?.code ?? '—'} → {c.endpointB?.code ?? '—'}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    {c.isActive ? (
                      <Badge tone="success">{t('active')}</Badge>
                    ) : (
                      <Badge tone="neutral">{t('inactive')}</Badge>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      {canWrite && (
                        <button
                          onClick={() => setEditing(c)}
                          title={tc('edit')}
                          className="p-1 text-text-muted hover:text-text"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                      )}
                      {canDelete && (
                        <button
                          onClick={() => setDeleting(c)}
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
        <CableFormDialog
          initial={editing === 'new' ? null : editing}
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
              await fiberCablesApi.remove(deleting.id);
              toast.success(t('deleted'));
              await mutate();
              setDeleting(null);
            } catch (err) {
              toast.error(
                err instanceof ApiError ? err.friendlyMessage : tc('error'),
              );
            }
          }}
          title={t('deleteConfirmTitle', { code: deleting.code })}
          message={t('deleteConfirmMessage')}
          confirmLabel={tc('delete')}
          variant="danger"
        />
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Form: criar / editar cabo
// ───────────────────────────────────────────────────────────────────────────
function CableFormDialog({
  initial,
  onClose,
  onSaved,
}: {
  initial: FiberCable | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('network.fiber');
  const tc = useTranslations('common');
  const isNew = !initial;
  const [code, setCode] = useState(initial?.code ?? '');
  const [type, setType] = useState<FiberCableType>(initial?.type ?? 'DROP');
  const [fiberCount, setFiberCount] = useState<number>(
    initial?.fiberCount ?? 12,
  );
  const [path, setPath] = useState<PathPoint[]>(initial?.path ?? []);
  const [overrideLength, setOverrideLength] = useState(
    initial?.lengthOverridden ?? false,
  );
  const [lengthMeters, setLengthMeters] = useState<number>(
    initial?.lengthMeters ?? 0,
  );
  const [endpointAId, setEndpointAId] = useState<string>(
    initial?.endpointAId ?? '',
  );
  const [endpointBId, setEndpointBId] = useState<string>(
    initial?.endpointBId ?? '',
  );
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Lista de caixas pra Selects de endpoint A/B (R4.5a).
  const { data: enclosuresResp } = useSWR<Paginated<OpticalEnclosure>>(
    opticalApi.listPath({ pageSize: 500 }),
  );
  const enclosures = enclosuresResp?.data ?? [];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return setError(t('errorCodeRequired'));
    if (path.length < 2) return setError(t('errorMinPoints'));
    setSubmitting(true);
    try {
      const payload: CreateFiberCableInput = {
        code: code.trim(),
        type,
        fiberCount,
        path,
        lengthMetersOverride: overrideLength ? lengthMeters : null,
        endpointAId: endpointAId || null,
        endpointBId: endpointBId || null,
        notes: notes || null,
        isActive,
      };
      if (isNew) {
        await fiberCablesApi.create(payload);
      } else {
        await fiberCablesApi.update(initial!.id, payload);
      }
      toast.success(isNew ? t('created') : t('updated'));
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
      title={
        isNew ? t('newCableTitle') : t('editTitle', { code: initial!.code })
      }
      size="xl"
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
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <Label required>{tc('code')}</Label>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="CABO-BB-001"
              autoFocus
            />
          </div>
          <div>
            <Label required>{tc('type')}</Label>
            <Select
              value={type}
              onChange={(e) => setType(e.target.value as FiberCableType)}
            >
              <option value="BACKBONE">{t('typeBackbone')}</option>
              <option value="DISTRIBUTION">{t('typeDistribution')}</option>
              <option value="DROP">{t('typeDrop')}</option>
            </Select>
          </div>
          <div>
            <Label required>{t('fiberCount')}</Label>
            <Select
              value={String(fiberCount)}
              onChange={(e) => setFiberCount(Number(e.target.value))}
            >
              {COMMON_FIBER_COUNTS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {/* R4.5a — pontas físicas. Sem isso, cabo flutua sem topologia. */}
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <Label htmlFor="cab-ep-a">{t('endpointA')}</Label>
            <Select
              id="cab-ep-a"
              value={endpointAId}
              onChange={(e) => setEndpointAId(e.target.value)}
            >
              <option value="">{t('endpointLoose')}</option>
              {enclosures.map((en) => (
                <option key={en.id} value={en.id}>
                  {en.code} ({en.type})
                </option>
              ))}
            </Select>
            <FieldHelp>{t('endpointAHelp')}</FieldHelp>
          </div>
          <div>
            <Label htmlFor="cab-ep-b">{t('endpointB')}</Label>
            <Select
              id="cab-ep-b"
              value={endpointBId}
              onChange={(e) => setEndpointBId(e.target.value)}
            >
              <option value="">{t('endpointLoose')}</option>
              {enclosures.map((en) => (
                <option key={en.id} value={en.id}>
                  {en.code} ({en.type})
                </option>
              ))}
            </Select>
            <FieldHelp>{t('endpointBHelp')}</FieldHelp>
          </div>
        </div>

        <div>
          <Label required>{t('mapPath')}</Label>
          <FieldHelp>{t('mapPathHelp')}</FieldHelp>
          <PolylineEditor value={path} onChange={setPath} />
        </div>

        <div className="rounded-md border border-border bg-surface-muted p-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={overrideLength}
              onChange={(e) => setOverrideLength(e.target.checked)}
            />
            {t('overrideLength')}
          </label>
          {overrideLength && (
            <div className="mt-2 flex items-center gap-2">
              <Input
                type="number"
                min={0}
                step={0.01}
                value={lengthMeters}
                onChange={(e) => setLengthMeters(Number(e.target.value))}
                className="max-w-[160px]"
              />
              <span className="text-xs text-text-muted">{t('meters')}</span>
            </div>
          )}
          {!overrideLength && path.length >= 2 && (
            <p className="mt-1 text-xs text-text-muted">
              {t('lengthAutoHint')}
            </p>
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

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
          />
          {t('active')}
        </label>

        {error && <p className="text-xs text-red-600">{error}</p>}
      </form>
    </Modal>
  );
}
