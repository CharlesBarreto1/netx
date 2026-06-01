'use client';

/**
 * /network/optical — CRUD de caixas ópticas (CTO/NAP/Splitter/Emenda).
 *
 * Lista paginada com filtro por tipo + busca por código/localização.
 * Click numa caixa abre detalhe com tabela de portas (atribuir contrato).
 * Forms usam LocationPicker pra geo obrigatória.
 *
 * Permissão: network.read / network.write / network.delete (reusa RBAC
 * de POPs/Equipment — caixas ópticas ainda são "rede física").
 */
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { Plus, Pencil, Trash2, Layers, Eye } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import useSWR from 'swr';

import type { LatLng } from '@/components/mapping/LocationPicker';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { FieldHelp, Input, Label, Select, Textarea } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api';
import { contractsApi, type Contract } from '@/lib/contracts-api';
import type { Paginated } from '@/lib/crm-types';
import {
  opticalApi,
  SPLITTER_OUTPUT_COUNT,
  type CreateEnclosureInput,
  type OpticalEnclosure,
  type OpticalEnclosureType,
  type OpticalMountType,
  type OpticalPort,
  type OpticalPortStatus,
  type SplitterRatio,
} from '@/lib/optical-api';
import { hasPermission } from '@/lib/session';
import { oltsApi, type Olt } from '@/lib/provisioning-api';
import { ponPortsApi } from '@/lib/pon-port-api';

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

const TYPES: OpticalEnclosureType[] = [
  'CTO',
  'NAP',
  'SPLITTER',
  'EMENDA',
  'RESERVA',
];

const STATUS_TONE: Record<
  OpticalPortStatus,
  'success' | 'warning' | 'info' | 'danger' | 'neutral'
> = {
  FREE: 'success',
  RESERVED: 'warning',
  USED: 'info',
  DAMAGED: 'danger',
};

function typeLabel(
  t: ReturnType<typeof useTranslations>,
  type: OpticalEnclosureType,
): string {
  return t(`typeLabel.${type}`);
}

function statusLabel(
  t: ReturnType<typeof useTranslations>,
  status: OpticalPortStatus,
): string {
  return t(`statusLabel.${status}`);
}

export default function OpticalEnclosuresPage() {
  const t = useTranslations('network.optical');
  const tc = useTranslations('common');
  const canWrite = hasPermission('network.write');
  const canDelete = hasPermission('network.delete');

  const [search, setSearch] = useState('');
  const [type, setType] = useState<OpticalEnclosureType | ''>('');
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const key = opticalApi.listPath({
    page,
    pageSize,
    type: type || undefined,
    search: search || undefined,
  });
  const { data, isLoading, mutate } =
    useSWR<Paginated<OpticalEnclosure>>(key);

  const [editing, setEditing] = useState<OpticalEnclosure | 'new' | null>(null);
  const [deleting, setDeleting] = useState<OpticalEnclosure | null>(null);
  const [showingPorts, setShowingPorts] = useState<OpticalEnclosure | null>(null);

  // Ação em massa: atribuir OLT a várias caixas (ex.: as 218 importadas do KMZ).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOltId, setBulkOltId] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const { data: bulkOltsResp } = useSWR(canWrite ? 'olts:all' : null, () =>
    oltsApi.list({ pageSize: 100 }),
  );
  const bulkOlts = bulkOltsResp?.data ?? [];

  function toggleSelected(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  async function handleBulkAssign() {
    setBulkBusy(true);
    try {
      const r = await opticalApi.assignOlt([...selected], bulkOltId || null);
      toast.success(t('toast.oltAssigned', { count: r.updated }));
      setSelected(new Set());
      setBulkOltId('');
      await mutate();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.friendlyMessage : tc('error'));
    } finally {
      setBulkBusy(false);
    }
  }

  async function selectAllFiltered() {
    try {
      const ids = await opticalApi.listIds({
        type: type || undefined,
        search: search || undefined,
      });
      setSelected(new Set(ids));
      toast.success(t('toast.selected', { count: ids.length }));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.friendlyMessage : tc('error'));
    }
  }

  if (isLoading && !data) return <PageLoader label={t('loadingBoxes')} />;

  const rows = data?.data ?? [];
  const total = data?.pagination.total ?? 0;
  const allVisibleSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggleAllVisible = () =>
    setSelected((s) => {
      const n = new Set(s);
      if (allVisibleSelected) rows.forEach((r) => n.delete(r.id));
      else rows.forEach((r) => n.add(r.id));
      return n;
    });

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
            {t('newBox')}
          </Button>
        )}
      </header>

      {/* Filtros */}
      <section className="grid grid-cols-1 gap-3 rounded-md border border-border bg-surface p-4 md:grid-cols-4">
        <div className="md:col-span-2">
          <Label htmlFor="opt-search">{tc('search')}</Label>
          <Input
            id="opt-search"
            placeholder={t('searchPlaceholder')}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div>
          <Label htmlFor="opt-type">{tc('type')}</Label>
          <Select
            id="opt-type"
            value={type}
            onChange={(e) => {
              setType(e.target.value as OpticalEnclosureType | '');
              setPage(1);
            }}
          >
            <option value="">{tc('all')}</option>
            {TYPES.map((tp) => (
              <option key={tp} value={tp}>
                {typeLabel(t, tp)}
              </option>
            ))}
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

      {/* Ação em massa: atribuir OLT às caixas selecionadas */}
      {canWrite && selected.size > 0 && (
        <section className="flex flex-wrap items-end gap-3 rounded-md border border-brand-300 bg-brand-50 p-3 dark:border-brand-900 dark:bg-brand-950">
          <div className="text-sm font-medium">{t('selectedCount', { count: selected.size })}</div>
          <div className="min-w-[240px] flex-1">
            <Label htmlFor="bulk-olt">{t('assignOlt')}</Label>
            <Select
              id="bulk-olt"
              value={bulkOltId}
              onChange={(e) => setBulkOltId(e.target.value)}
            >
              <option value="">{t('noOltClear')}</option>
              {bulkOlts.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} ({o.vendor}/{o.providerMode})
                </option>
              ))}
            </Select>
          </div>
          <Button type="button" loading={bulkBusy} onClick={handleBulkAssign}>
            {t('assignTo', { count: selected.size })}
          </Button>
          {total > selected.size && (
            <Button type="button" variant="secondary" onClick={selectAllFiltered}>
              {t('selectAll', { count: total })}
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={() => setSelected(new Set())}>
            {t('clearSelection')}
          </Button>
        </section>
      )}

      {/* Lista */}
      <div className="overflow-x-auto rounded-md border border-border bg-surface">
        <table className="min-w-full text-sm">
          <thead className="bg-surface-muted text-left text-[11px] font-semibold uppercase tracking-wider text-text-muted">
            <tr>
              <th className="w-8 px-3 py-2">
                {canWrite && rows.length > 0 && (
                  <input
                    type="checkbox"
                    aria-label={t('selectAllVisible')}
                    checked={allVisibleSelected}
                    onChange={toggleAllVisible}
                  />
                )}
              </th>
              <th className="px-3 py-2">{tc('code')}</th>
              <th className="px-3 py-2">{tc('type')}</th>
              <th className="px-3 py-2">{t('col.splitter')}</th>
              <th className="px-3 py-2">{t('col.occupancy')}</th>
              <th className="px-3 py-2">{t('col.location')}</th>
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
              rows.map((e) => (
                <tr
                  key={e.id}
                  className="cursor-pointer hover:bg-surface-hover"
                  onClick={() => {
                    window.location.href = `/network/optical/${e.id}`;
                  }}
                >
                  <td className="px-3 py-2" onClick={(ev) => ev.stopPropagation()}>
                    <input
                      type="checkbox"
                      aria-label={t('selectOne', { code: e.code })}
                      checked={selected.has(e.id)}
                      onChange={() => toggleSelected(e.id)}
                    />
                  </td>
                  <td className="px-3 py-2 font-medium text-text">{e.code}</td>
                  <td className="px-3 py-2 text-text-muted">
                    {typeLabel(t, e.type)}
                  </td>
                  <td className="px-3 py-2 text-text-muted">
                    {e.splitterRatio
                      ? `1:${SPLITTER_OUTPUT_COUNT[e.splitterRatio]}`
                      : '—'}
                  </td>
                  <td className="px-3 py-2">
                    <OccupancyBar
                      pct={e.stats?.occupancyPct ?? 0}
                      used={
                        (e.stats?.portsUsed ?? 0) +
                        (e.stats?.portsReserved ?? 0)
                      }
                      total={e.capacity}
                    />
                  </td>
                  <td className="px-3 py-2 text-text-muted">
                    {e.locationLabel ?? `${e.latitude.toFixed(4)}, ${e.longitude.toFixed(4)}`}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      <Link
                        href={`/network/optical/${e.id}`}
                        onClick={(ev) => ev.stopPropagation()}
                        title={t('viewSchematic')}
                        className="p-1 text-text-muted hover:text-text"
                      >
                        <Eye className="h-4 w-4" />
                      </Link>
                      <button
                        onClick={(ev) => {
                          ev.stopPropagation();
                          setShowingPorts(e);
                        }}
                        title={t('viewPorts')}
                        className="p-1 text-text-muted hover:text-text"
                      >
                        <Layers className="h-4 w-4" />
                      </button>
                      {canWrite && (
                        <button
                          onClick={(ev) => {
                            ev.stopPropagation();
                            setEditing(e);
                          }}
                          title={tc('edit')}
                          className="p-1 text-text-muted hover:text-text"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                      )}
                      {canDelete && (
                        <button
                          onClick={(ev) => {
                            ev.stopPropagation();
                            setDeleting(e);
                          }}
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
            {tc('page')} {data.pagination.page} {tc('of')} {data.pagination.totalPages}
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
        <EnclosureFormDialog
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
              await opticalApi.remove(deleting.id);
              toast.success(t('toast.deleted'));
              await mutate();
              setDeleting(null);
            } catch (err) {
              toast.error(
                err instanceof ApiError ? err.friendlyMessage : tc('error'),
              );
            }
          }}
          title={t('deleteTitle', { code: deleting.code })}
          message={t('deleteMessage')}
          confirmLabel={tc('delete')}
          variant="danger"
        />
      )}

      {showingPorts && (
        <PortsModal
          enclosure={showingPorts}
          onClose={() => {
            setShowingPorts(null);
            mutate(); // re-fetch stats
          }}
        />
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Visual: barra de ocupação
// ───────────────────────────────────────────────────────────────────────────
function OccupancyBar({
  pct,
  used,
  total,
}: {
  pct: number;
  used: number;
  total: number;
}) {
  const color =
    pct >= 80 ? 'bg-red-500' : pct >= 50 ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-24 overflow-hidden rounded-full bg-surface-muted">
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-text-muted whitespace-nowrap">
        {used}/{total}
      </span>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Form: criar / editar caixa
// ───────────────────────────────────────────────────────────────────────────
function EnclosureFormDialog({
  initial,
  onClose,
  onSaved,
}: {
  initial: OpticalEnclosure | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('network.optical');
  const tc = useTranslations('common');
  const isNew = !initial;
  const [form, setForm] = useState<CreateEnclosureInput>({
    code: initial?.code ?? '',
    type: initial?.type ?? 'CTO',
    parentId: initial?.parentId ?? null,
    latitude: initial?.latitude ?? 0,
    longitude: initial?.longitude ?? 0,
    mountType: initial?.mountType ?? null,
    splitterRatio: initial?.splitterRatio ?? null,
    capacity: initial?.capacity ?? 16,
    locationLabel: initial?.locationLabel ?? null,
    notes: initial?.notes ?? null,
    isActive: initial?.isActive ?? true,
    oltId: initial?.oltId ?? null,
    ponPortId: initial?.ponPortId ?? null,
  });
  const [location, setLocation] = useState<LatLng | null>(
    initial ? { latitude: initial.latitude, longitude: initial.longitude } : null,
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // OLT que atende a caixa + PON (PON só pra OLT DIRECT; Ufinet abstrai).
  const { data: oltsResp } = useSWR('olts:all', () => oltsApi.list({ pageSize: 100 }));
  const olts: Olt[] = oltsResp?.data ?? [];
  const selectedOlt = olts.find((o) => o.id === form.oltId);
  const oltIsDirect = selectedOlt?.providerMode === 'DIRECT';
  const { data: ponPorts } = useSWR(
    oltIsDirect && form.oltId ? ponPortsApi.listByOltPath(form.oltId) : null,
    () => ponPortsApi.listByOlt(form.oltId as string),
  );

  // Quando muda o splitterRatio, sugere capacity = número de saídas.
  function setSplitterRatio(ratio: SplitterRatio | null) {
    setForm((f) => ({
      ...f,
      splitterRatio: ratio,
      capacity:
        ratio && (isNew || f.capacity === initial?.capacity)
          ? SPLITTER_OUTPUT_COUNT[ratio]
          : f.capacity,
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.code.trim()) return setError(t('err.codeRequired'));
    if (!location) return setError(t('err.markLocation'));
    setSubmitting(true);
    try {
      const payload: CreateEnclosureInput = {
        ...form,
        latitude: location.latitude,
        longitude: location.longitude,
      };
      if (isNew) {
        await opticalApi.create(payload);
      } else {
        await opticalApi.update(initial!.id, payload);
      }
      toast.success(isNew ? t('toast.created') : t('toast.updated'));
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
      title={isNew ? t('newBoxTitle') : t('editTitle', { code: initial!.code })}
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
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <Label required>{tc('code')}</Label>
            <Input
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              placeholder="CTO-001"
              autoFocus
            />
          </div>
          <div>
            <Label required>{tc('type')}</Label>
            <Select
              value={form.type}
              onChange={(e) =>
                setForm({
                  ...form,
                  type: e.target.value as OpticalEnclosureType,
                })
              }
            >
              {TYPES.map((tp) => (
                <option key={tp} value={tp}>
                  {typeLabel(t, tp)}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>{t('col.splitter')}</Label>
            <Select
              value={form.splitterRatio ?? ''}
              onChange={(e) =>
                setSplitterRatio(
                  (e.target.value as SplitterRatio) || null,
                )
              }
            >
              <option value="">{t('noSplitter')}</option>
              {(
                ['ONE_TO_2', 'ONE_TO_4', 'ONE_TO_8', 'ONE_TO_16', 'ONE_TO_32', 'ONE_TO_64'] as SplitterRatio[]
              ).map((r) => (
                <option key={r} value={r}>
                  1:{SPLITTER_OUTPUT_COUNT[r]}
                </option>
              ))}
            </Select>
            <FieldHelp>{t('help.splitterLoss')}</FieldHelp>
          </div>
          <div>
            <Label required>{t('capacityLabel')}</Label>
            <Input
              type="number"
              min={1}
              max={256}
              value={form.capacity}
              onChange={(e) =>
                setForm({ ...form, capacity: Number(e.target.value) })
              }
            />
            <FieldHelp>{t('help.capacity')}</FieldHelp>
          </div>
          <div>
            <Label>{t('mountLabel')}</Label>
            <Select
              value={form.mountType ?? ''}
              onChange={(e) =>
                setForm({
                  ...form,
                  mountType: (e.target.value as OpticalMountType) || null,
                })
              }
            >
              <option value="">—</option>
              <option value="POSTE">{t('mount.POSTE')}</option>
              <option value="AEREO">{t('mount.AEREO')}</option>
              <option value="SUBTERRANEO">{t('mount.SUBTERRANEO')}</option>
              <option value="PAREDE">{t('mount.PAREDE')}</option>
              <option value="RACK">{t('mount.RACK')}</option>
            </Select>
          </div>
          <div>
            <Label>{t('addressLabel')}</Label>
            <Input
              value={form.locationLabel ?? ''}
              onChange={(e) =>
                setForm({ ...form, locationLabel: e.target.value || null })
              }
              placeholder="Poste 027, Av. Mariscal Lopez"
            />
          </div>
          <div>
            <Label>{t('oltLabel')}</Label>
            <Select
              value={form.oltId ?? ''}
              onChange={(e) =>
                setForm({ ...form, oltId: e.target.value || null, ponPortId: null })
              }
            >
              <option value="">{t('noOlt')}</option>
              {olts.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} ({o.vendor}/{o.providerMode})
                </option>
              ))}
            </Select>
            <FieldHelp>{t('help.olt')}</FieldHelp>
          </div>
          {oltIsDirect && (
            <div>
              <Label>{t('ponPortLabel')}</Label>
              <Select
                value={form.ponPortId ?? ''}
                onChange={(e) =>
                  setForm({ ...form, ponPortId: e.target.value || null })
                }
              >
                <option value="">{t('noPon')}</option>
                {(ponPorts ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    PON {p.ponIndex}
                    {p.cable ? ` · ${p.cable.code}` : ''}
                  </option>
                ))}
              </Select>
            </div>
          )}
        </div>

        <div>
          <Label required>{t('mapLocationLabel')}</Label>
          <FieldHelp>{t('help.mapLocation')}</FieldHelp>
          <LocationPicker value={location} onChange={setLocation} />
        </div>

        <div>
          <Label>{tc('notes')}</Label>
          <Textarea
            rows={2}
            value={form.notes ?? ''}
            onChange={(e) =>
              setForm({ ...form, notes: e.target.value || null })
            }
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

        {error && <p className="text-xs text-red-600">{error}</p>}
      </form>
    </Modal>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Modal: portas da caixa
// ───────────────────────────────────────────────────────────────────────────
function PortsModal({
  enclosure,
  onClose,
}: {
  enclosure: OpticalEnclosure;
  onClose: () => void;
}) {
  const t = useTranslations('network.optical');
  const tc = useTranslations('common');
  const canWrite = hasPermission('network.write');

  const { data: ports, mutate } = useSWR<OpticalPort[]>(
    opticalApi.portsPath(enclosure.id),
  );

  const [editingPort, setEditingPort] = useState<OpticalPort | null>(null);

  return (
    <Modal
      open
      onClose={onClose}
      title={t('portsTitle', { code: enclosure.code })}
      size="lg"
    >
      <div className="space-y-3">
        <div className="text-sm text-text-muted">
          {t('portsTotal', { count: enclosure.capacity })}
          {enclosure.splitterRatio
            ? ` ${t('splitterSuffix', { count: SPLITTER_OUTPUT_COUNT[enclosure.splitterRatio] })}`
            : ''}
        </div>

        <div className="max-h-[60vh] overflow-y-auto rounded-md border border-border">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 bg-surface-muted text-left text-[11px] font-semibold uppercase tracking-wider text-text-muted">
              <tr>
                <th className="px-3 py-2">#</th>
                <th className="px-3 py-2">{tc('status')}</th>
                <th className="px-3 py-2">{t('contractCustomer')}</th>
                <th className="px-3 py-2">{t('portNote')}</th>
                <th className="px-3 py-2 text-right">{t('portAction')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(ports ?? []).map((p) => (
                <tr key={p.id}>
                  <td className="px-3 py-2 font-mono text-xs">{p.number}</td>
                  <td className="px-3 py-2">
                    <Badge tone={STATUS_TONE[p.status]}>
                      {statusLabel(t, p.status)}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-text-muted">
                    {p.contract
                      ? `${p.contract.code ?? p.contract.id.slice(0, 8)} · ${p.contract.customer.displayName}`
                      : '—'}
                  </td>
                  <td className="px-3 py-2 text-text-muted truncate max-w-[200px]">
                    {p.notes ?? ''}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {canWrite && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setEditingPort(p)}
                      >
                        {t('assign')}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editingPort && (
        <PortAssignDialog
          port={editingPort}
          onClose={() => setEditingPort(null)}
          onSaved={async () => {
            await mutate();
            setEditingPort(null);
          }}
        />
      )}
    </Modal>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Dialog: atribuir / mudar status de uma porta
// ───────────────────────────────────────────────────────────────────────────
function PortAssignDialog({
  port,
  onClose,
  onSaved,
}: {
  port: OpticalPort;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('network.optical');
  const tc = useTranslations('common');
  const [status, setStatus] = useState<OpticalPortStatus>(port.status);
  const [contractId, setContractId] = useState<string | null>(
    port.contractId,
  );
  const [contractSearch, setContractSearch] = useState('');
  const [notes, setNotes] = useState<string>(port.notes ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Autocomplete simples: busca contratos a cada keystroke (com debounce
  // implícito via SWR cache — chave varia, mas cache de 60s evita spam).
  const { data: contractsResp } = useSWR<Paginated<Contract>>(
    contractSearch.length >= 2
      ? contractsApi.listPath({ search: contractSearch, pageSize: 10 })
      : null,
  );
  const contracts = contractsResp?.data ?? [];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await opticalApi.updatePort(port.id, {
        status,
        contractId: status === 'USED' ? contractId : null,
        notes: notes || null,
      });
      toast.success(t('toast.portUpdated'));
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
      title={t('portTitle', { number: port.number })}
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
        <div>
          <Label required>{tc('status')}</Label>
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value as OpticalPortStatus)}
          >
            <option value="FREE">{statusLabel(t, 'FREE')}</option>
            <option value="RESERVED">{statusLabel(t, 'RESERVED')}</option>
            <option value="USED">{t('statusUsedAssign')}</option>
            <option value="DAMAGED">{statusLabel(t, 'DAMAGED')}</option>
          </Select>
        </div>

        {status === 'USED' && (
          <div>
            <Label required>{t('contract')}</Label>
            <Input
              placeholder={t('contractSearchPlaceholder')}
              value={contractSearch}
              onChange={(e) => setContractSearch(e.target.value)}
            />
            {contractId && !contractSearch && (
              <div className="mt-1 text-xs text-text-muted">
                {t('selected')}:{' '}
                <span className="font-mono">{contractId.slice(0, 8)}</span>
              </div>
            )}
            {contracts.length > 0 && (
              <div className="mt-1 max-h-40 overflow-y-auto rounded-md border border-border bg-surface">
                {contracts.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={`block w-full px-3 py-1.5 text-left text-xs hover:bg-surface-hover ${
                      contractId === c.id ? 'bg-surface-muted' : ''
                    }`}
                    onClick={() => {
                      setContractId(c.id);
                      setContractSearch(
                        `${c.code ?? c.id.slice(0, 8)} · ${c.customer?.displayName ?? ''}`,
                      );
                    }}
                  >
                    {c.code ?? c.id.slice(0, 8)} ·{' '}
                    {c.customer?.displayName ?? '—'}
                    <span className="ml-2 text-text-muted">
                      ({c.pppoeUsername ?? '—'})
                    </span>
                  </button>
                ))}
              </div>
            )}
            <FieldHelp>{t('help.contractOnePort')}</FieldHelp>
          </div>
        )}

        <div>
          <Label>{t('portNote')}</Label>
          <Textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t('notePlaceholder')}
          />
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}
      </form>
    </Modal>
  );
}
