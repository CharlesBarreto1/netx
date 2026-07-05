'use client';

/**
 * CableDetailDrawer — detalhe do cabo no estúdio (FM-2, spec §3.4/§7).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Mostra o snapshot do modelo (estrutura + tubos), ocupação por status,
 * comprimentos (geográfico / medido / ÓPTICO com reservas — spec §5.2),
 * tabela de segmentos (metragem medida editável; excluir só o último) e
 * reservas técnicas (criar/remover). Edição leve: nome, cor, fator de
 * excesso (calibração por instância, spec §14.10).
 */
import { Scissors, Trash2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import useSWR from 'swr';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { InlineLoader } from '@/components/ui/Spinner';
import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api';
import {
  FIBERMAP_COLOR_HEX,
  fibermapApi,
  type FibermapCable,
  type FibermapColorCode,
  type FibermapSegment,
} from '@/lib/fibermap-api';

import { StudioConfirm } from './StudioModal';

const FIELD =
  'w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-text outline-none focus:border-accent';

function meters(n: number): string {
  return `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} m`;
}

export function CableDetailDrawer({
  cableId,
  canWrite,
  canDelete,
  onChanged,
  onDeleted,
  onClose,
}: {
  cableId: string;
  canWrite: boolean;
  canDelete: boolean;
  /** Qualquer mutação persistida (mapa refaz o fetch). */
  onChanged: () => void;
  onDeleted: () => void;
  onClose: () => void;
}) {
  const t = useTranslations('fibermap');
  const tc = useTranslations('common');

  const {
    data: cable,
    error,
    mutate,
  } = useSWR<FibermapCable>(`/v1/fibermap/cables/${cableId}`);

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState('#3b82f6');
  const [excess, setExcess] = useState('');
  const [busy, setBusy] = useState(false);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmSegment, setConfirmSegment] = useState<FibermapSegment | null>(null);

  // Reserva técnica (form inline)
  const [slackSegmentId, setSlackSegmentId] = useState('');
  const [slackElementId, setSlackElementId] = useState('');
  const [slackLength, setSlackLength] = useState('');

  function friendly(err: unknown): string {
    return err instanceof ApiError ? err.friendlyMessage : tc('error');
  }

  async function applyCable(patch: Parameters<typeof fibermapApi.updateCable>[1]) {
    setBusy(true);
    try {
      const updated = await fibermapApi.updateCable(cableId, patch);
      await mutate(updated, { revalidate: false });
      onChanged();
      return true;
    } catch (err) {
      toast.error(friendly(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit() {
    if (!name.trim()) return;
    const excessNum = excess.trim() ? Number(excess.trim().replace(',', '.')) : undefined;
    if (excessNum !== undefined && !(excessNum >= 1 && excessNum <= 1.5)) {
      toast.error(t('settings.cable.excessFactorError'));
      return;
    }
    const ok = await applyCable({
      name: name.trim(),
      displayColor: color,
      excessFactor: excessNum,
    });
    if (ok) {
      setEditing(false);
      toast.success(t('studio.cable.saved'));
    }
  }

  async function saveMeasured(segment: FibermapSegment, raw: string) {
    const trimmed = raw.trim();
    const value = trimmed ? Number(trimmed.replace(',', '.')) : null;
    if (value !== null && !(value > 0)) {
      toast.error(t('studio.cable.errorMeasured'));
      return;
    }
    // Evita PATCH sem mudança (blur dispara sempre).
    if ((value ?? null) === (segment.measuredLengthM ?? null)) return;
    try {
      const updated = await fibermapApi.updateSegment(segment.id, {
        measuredLengthM: value,
      });
      await mutate(updated, { revalidate: false });
      onChanged();
      toast.success(t('studio.cable.measuredSaved'));
    } catch (err) {
      toast.error(friendly(err));
    }
  }

  async function deleteLastSegment() {
    if (!confirmSegment) return;
    setBusy(true);
    try {
      const updated = await fibermapApi.deleteSegment(confirmSegment.id);
      await mutate(updated, { revalidate: false });
      setConfirmSegment(null);
      onChanged();
      toast.success(t('studio.cable.segmentDeleted'));
    } catch (err) {
      toast.error(friendly(err));
    } finally {
      setBusy(false);
    }
  }

  async function addSlack() {
    const length = Number(slackLength.trim().replace(',', '.'));
    if (!slackSegmentId || !slackElementId || !(length > 0)) {
      toast.error(t('studio.cable.slackInvalid'));
      return;
    }
    setBusy(true);
    try {
      const updated = await fibermapApi.addSlack(cableId, {
        segmentId: slackSegmentId,
        elementId: slackElementId,
        lengthM: length,
      });
      await mutate(updated, { revalidate: false });
      setSlackLength('');
      onChanged();
      toast.success(t('studio.cable.slackAdded'));
    } catch (err) {
      toast.error(friendly(err));
    } finally {
      setBusy(false);
    }
  }

  async function removeSlack(slackId: string) {
    try {
      const updated = await fibermapApi.deleteSlack(slackId);
      await mutate(updated, { revalidate: false });
      onChanged();
    } catch (err) {
      toast.error(friendly(err));
    }
  }

  async function deleteCable() {
    setBusy(true);
    try {
      await fibermapApi.deleteCable(cableId);
      setConfirmDelete(false);
      toast.success(t('studio.cable.deleted'));
      onDeleted();
    } catch (err) {
      // 409 = fusões/cortes ativos (spec §14.2)
      toast.error(friendly(err));
    } finally {
      setBusy(false);
    }
  }

  const lastSeq = cable?.segments.length
    ? cable.segments[cable.segments.length - 1].seq
    : 0;
  const slackSegment = cable?.segments.find((s) => s.id === slackSegmentId);
  const occupied = cable ? cable.occupancy.active + cable.occupancy.reserved : 0;
  const occupancyPct = cable && cable.occupancy.total > 0
    ? Math.round((occupied / cable.occupancy.total) * 100)
    : 0;

  return (
    <aside className="fixed right-0 top-12 z-[1600] flex h-[calc(100vh-3rem)] w-96 max-w-[calc(100vw-2rem)] flex-col border-l border-border bg-surface shadow-2xl">
      <header className="flex items-center justify-between gap-2 border-b border-border bg-surface-muted px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          {cable ? (
            <>
              <span
                className="inline-block h-3 w-6 shrink-0 rounded-sm"
                style={{ backgroundColor: cable.displayColor ?? '#64748b' }}
              />
              <span className="truncate text-sm font-semibold text-text">
                {cable.name}
              </span>
              <Badge tone="neutral">{cable.fiberCount} FO</Badge>
            </>
          ) : (
            <span className="text-sm text-text-muted">{tc('loading')}</span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          title={tc('close')}
          className="rounded p-1 text-text-muted hover:bg-surface-hover hover:text-text"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto p-3">
        {error ? (
          <p className="text-sm text-danger">{friendly(error)}</p>
        ) : !cable ? (
          <div className="flex justify-center py-8">
            <InlineLoader label={tc('loading')} />
          </div>
        ) : (
          <>
            {/* ── Snapshot do modelo ─────────────────────────────────────── */}
            <section className="space-y-1.5 text-sm">
              <div className="flex justify-between gap-2">
                <span className="text-text-muted">{t('studio.cable.model')}</span>
                <span className="text-right font-medium text-text">
                  {cable.productName ?? t('studio.cable.noModel')}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-text-muted">{t('settings.cable.structureLegend')}</span>
                <span className="font-medium text-text">
                  {cable.tubeCount}×{cable.fibersPerTube} ·{' '}
                  {cable.colorStandard === 'ABNT' ? 'ABNT' : 'EIA/TIA-598'}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-text-muted">{t('studio.cable.tubes')}</span>
                <span className="flex flex-wrap justify-end gap-1">
                  {cable.tubes.map((tube) => (
                    <span
                      key={tube.tubeNumber}
                      title={`#${tube.tubeNumber} ${tube.color}`}
                      className="inline-flex h-4 w-6 items-center justify-center rounded-sm border border-border-strong text-[9px] font-bold"
                      style={{
                        backgroundColor:
                          FIBERMAP_COLOR_HEX[tube.color as FibermapColorCode] ?? '#e2e8f0',
                        color: ['BRANCA', 'AMARELA'].includes(tube.color)
                          ? '#334155'
                          : '#ffffff',
                      }}
                    >
                      {tube.tubeNumber}
                    </span>
                  ))}
                </span>
              </div>
            </section>

            {/* ── Ocupação ───────────────────────────────────────────────── */}
            <section className="space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className="text-text-muted">{t('studio.cable.occupancy')}</span>
                <span className="font-medium text-text">
                  {occupied}/{cable.occupancy.total} ({occupancyPct}%)
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-surface-muted">
                <div
                  className={`h-full ${occupancyPct >= 80 ? 'bg-danger' : occupancyPct >= 50 ? 'bg-warning' : 'bg-success'}`}
                  style={{ width: `${occupancyPct}%` }}
                />
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-text-muted">
                <span>{t('studio.cable.occDark', { count: cable.occupancy.dark })}</span>
                <span>{t('studio.cable.occActive', { count: cable.occupancy.active })}</span>
                <span>{t('studio.cable.occReserved', { count: cable.occupancy.reserved })}</span>
                {cable.occupancy.broken > 0 && (
                  <span className="text-danger">
                    {t('studio.cable.occBroken', { count: cable.occupancy.broken })}
                  </span>
                )}
              </div>
            </section>

            {/* ── Comprimentos ───────────────────────────────────────────── */}
            <section className="grid grid-cols-3 gap-2 text-center">
              {(
                [
                  ['totalGeometricM', t('studio.cable.geoTotal')],
                  ['totalSlackM', t('studio.cable.slackTotal')],
                  ['totalOpticalM', t('studio.cable.opticalTotal')],
                ] as const
              ).map(([key, label]) => (
                <div key={key} className="rounded-md bg-surface-muted px-2 py-2">
                  <div className="text-sm font-semibold text-text">
                    {meters(cable[key])}
                  </div>
                  <div className="text-[11px] text-text-muted">{label}</div>
                </div>
              ))}
            </section>

            {/* ── Edição leve ────────────────────────────────────────────── */}
            {editing ? (
              <section className="space-y-2 rounded-md border border-border p-2.5">
                <input
                  className={FIELD}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={tc('name')}
                />
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-text-muted">{t('studio.cable.color')}</span>
                  <input
                    type="color"
                    className="h-8 w-14 cursor-pointer rounded border border-border bg-surface"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                  />
                  <span className="ml-auto text-text-muted">
                    {t('settings.cable.excessFactor')}
                  </span>
                  <input
                    className={`${FIELD} w-20`}
                    value={excess}
                    onChange={(e) => setExcess(e.target.value)}
                    inputMode="decimal"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button size="xs" variant="ghost" onClick={() => setEditing(false)}>
                    {tc('cancel')}
                  </Button>
                  <Button size="xs" onClick={() => void saveEdit()} loading={busy}>
                    {tc('save')}
                  </Button>
                </div>
              </section>
            ) : (
              <div className="flex gap-2">
                {canWrite && (
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => {
                      setName(cable.name);
                      setColor(cable.displayColor ?? '#3b82f6');
                      setExcess(String(cable.excessFactor));
                      setEditing(true);
                    }}
                  >
                    {tc('edit')}
                  </Button>
                )}
                {canDelete && (
                  <Button
                    size="xs"
                    variant="ghost"
                    className="text-danger"
                    onClick={() => setConfirmDelete(true)}
                  >
                    <Trash2 className="mr-1 h-3.5 w-3.5" />
                    {tc('delete')}
                  </Button>
                )}
              </div>
            )}

            {/* ── Segmentos ──────────────────────────────────────────────── */}
            <section className="space-y-1.5">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                {t('studio.cable.segments')}
              </h4>
              {cable.segments.length === 0 ? (
                <p className="text-xs text-text-subtle">{t('studio.cable.noSegments')}</p>
              ) : (
                cable.segments.map((s) => (
                  <div
                    key={s.id}
                    className="space-y-1 rounded-md border border-border px-2.5 py-2 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate font-medium text-text">
                        #{s.seq} {s.fromElementName} → {s.toElementName}
                      </span>
                      {canWrite && s.seq === lastSeq && (
                        <button
                          type="button"
                          title={t('studio.cable.deleteSegment')}
                          className="rounded p-0.5 text-text-muted hover:bg-surface-hover hover:text-danger"
                          onClick={() => setConfirmSegment(s)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-2 text-text-muted">
                      <span>
                        {meters(s.geometricLengthM)} (geo) ·{' '}
                        <span className="font-medium text-text">
                          {meters(s.opticalLengthM)} (ópt)
                        </span>
                      </span>
                      {canWrite ? (
                        <input
                          className="w-24 rounded border border-border bg-surface px-1.5 py-0.5 text-right text-xs text-text outline-none focus:border-accent"
                          defaultValue={s.measuredLengthM ?? ''}
                          placeholder={t('studio.cable.measuredShort')}
                          inputMode="decimal"
                          onBlur={(e) => void saveMeasured(s, e.target.value)}
                        />
                      ) : (
                        s.measuredLengthM !== null && (
                          <span>{meters(s.measuredLengthM)} (med)</span>
                        )
                      )}
                    </div>
                    {s.slacks.map((sl) => (
                      <div
                        key={sl.id}
                        className="flex items-center justify-between gap-2 rounded bg-surface-muted px-1.5 py-1 text-text-muted"
                      >
                        <span className="flex min-w-0 items-center gap-1">
                          <Scissors className="h-3 w-3 shrink-0 rotate-90" />
                          <span className="truncate">
                            {t('studio.cable.slackAt', {
                              length: sl.lengthM,
                              element: sl.elementName,
                            })}
                          </span>
                        </span>
                        {canWrite && (
                          <button
                            type="button"
                            className="rounded p-0.5 hover:bg-surface-hover hover:text-danger"
                            onClick={() => void removeSlack(sl.id)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                ))
              )}
            </section>

            {/* ── Nova reserva técnica ───────────────────────────────────── */}
            {canWrite && cable.segments.length > 0 && (
              <section className="space-y-2 rounded-md border border-dashed border-border p-2.5">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                  {t('studio.cable.newSlack')}
                </h4>
                <select
                  className={FIELD}
                  value={slackSegmentId}
                  onChange={(e) => {
                    setSlackSegmentId(e.target.value);
                    setSlackElementId('');
                  }}
                >
                  <option value="">{t('studio.cable.slackSegment')}</option>
                  {cable.segments.map((s) => (
                    <option key={s.id} value={s.id}>
                      #{s.seq} {s.fromElementName} → {s.toElementName}
                    </option>
                  ))}
                </select>
                {slackSegment && (
                  <select
                    className={FIELD}
                    value={slackElementId}
                    onChange={(e) => setSlackElementId(e.target.value)}
                  >
                    <option value="">{t('studio.cable.slackElement')}</option>
                    <option value={slackSegment.fromElementId}>
                      {slackSegment.fromElementName}
                    </option>
                    <option value={slackSegment.toElementId}>
                      {slackSegment.toElementName}
                    </option>
                  </select>
                )}
                <div className="flex gap-2">
                  <input
                    className={FIELD}
                    value={slackLength}
                    onChange={(e) => setSlackLength(e.target.value)}
                    placeholder={t('studio.cable.slackLength')}
                    inputMode="decimal"
                  />
                  <Button size="xs" onClick={() => void addSlack()} loading={busy}>
                    {tc('create')}
                  </Button>
                </div>
              </section>
            )}
          </>
        )}
      </div>

      {/* ── Confirmações ─────────────────────────────────────────────────── */}
      {confirmDelete && cable && (
        <StudioConfirm
          title={t('studio.cable.deleteTitle', { name: cable.name })}
          message={t('studio.cable.deleteMessage')}
          confirmLabel={tc('delete')}
          danger
          loading={busy}
          onClose={() => {
            if (!busy) setConfirmDelete(false);
          }}
          onConfirm={deleteCable}
        />
      )}
      {confirmSegment && (
        <StudioConfirm
          title={t('studio.cable.deleteSegmentTitle', { seq: confirmSegment.seq })}
          message={t('studio.cable.deleteSegmentMessage')}
          confirmLabel={tc('delete')}
          danger
          loading={busy}
          onClose={() => {
            if (!busy) setConfirmSegment(null);
          }}
          onConfirm={deleteLastSegment}
        />
      )}
    </aside>
  );
}
