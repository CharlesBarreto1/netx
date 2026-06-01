'use client';

/**
 * /network/otdr — eventos OTDR (R6 OSP).
 *
 * Fluxo:
 *   1. Operador informa cabo + distância (km) lida do OTDR + tipo de evento.
 *   2. Backend caminha o path do cabo, calcula lat/lng do ponto.
 *   3. Pino vermelho aparece no mapa pra equipe de campo localizar.
 *   4. Após reparo, marca "Resolvido" → pino some do mapa (vai pro histórico).
 *
 * Lista 2 colunas:
 *   - Esquerda: form de criar evento + lista de eventos ATIVOS.
 *   - Direita: histórico (resolvidos).
 */
import {
  AlertTriangle,
  Check,
  Clock,
  ImageIcon,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
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
  fiberCablesApi,
  type FiberCable,
} from '@/lib/fiber-api';
import {
  fiberEventsApi,
  type CreateFiberEventInput,
  type FiberEvent,
  type FiberEventType,
} from '@/lib/fiber-events-api';
import { hasPermission } from '@/lib/session';

const TYPE_TONE: Record<
  FiberEventType,
  'danger' | 'warning' | 'info' | 'neutral'
> = {
  BREAK: 'danger',
  BEND: 'warning',
  REFLECTION: 'warning',
  ATTENUATION: 'warning',
  CONNECTOR: 'info',
  OTHER: 'neutral',
};

export default function OtdrPage() {
  const t = useTranslations('network.otdr');
  const tc = useTranslations('common');
  const canWrite = hasPermission('network.write');

  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<FiberEvent | null>(null);
  const [photoViewing, setPhotoViewing] = useState<FiberEvent | null>(null);

  const { data: activeData, isLoading, mutate: mutateActive } = useSWR<
    Paginated<FiberEvent>
  >(fiberEventsApi.listPath({ status: 'active', pageSize: 200 }));
  const { data: resolvedData, mutate: mutateResolved } = useSWR<
    Paginated<FiberEvent>
  >(fiberEventsApi.listPath({ status: 'resolved', pageSize: 50 }));

  if (isLoading && !activeData) return <PageLoader label={t('loadingEvents')} />;

  const active = activeData?.data ?? [];
  const resolved = resolvedData?.data ?? [];

  async function refresh() {
    await Promise.all([mutateActive(), mutateResolved()]);
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <AlertTriangle className="h-6 w-6" />
            {t('title')}
          </h1>
          <p className="text-sm text-text-muted">
            {t('subtitle')}
          </p>
        </div>
        {canWrite && (
          <Button onClick={() => setCreating(true)}>
            {t('registerEvent')}
          </Button>
        )}
      </header>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* ─── Ativos ──────────────────────────────────────────────────────── */}
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <AlertTriangle className="h-4 w-4 text-red-600" />
            {t('activeCount', { count: active.length })}
          </h2>

          {active.length === 0 ? (
            <div className="rounded-md border border-border bg-surface p-6 text-center text-sm text-text-muted">
              {t('emptyActive')}
            </div>
          ) : (
            <ul className="space-y-2">
              {active.map((ev) => (
                <EventCard
                  key={ev.id}
                  event={ev}
                  canWrite={canWrite}
                  onResolve={async (notes) => {
                    try {
                      await fiberEventsApi.resolve(ev.id, notes);
                      toast.success(t('toastResolved'));
                      await refresh();
                    } catch (err) {
                      toast.error(
                        err instanceof ApiError
                          ? err.friendlyMessage
                          : tc('error'),
                      );
                    }
                  }}
                  onDelete={() => setDeleting(ev)}
                  onViewPhoto={() => setPhotoViewing(ev)}
                />
              ))}
            </ul>
          )}
        </section>

        {/* ─── Resolvidos ──────────────────────────────────────────────────── */}
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Clock className="h-4 w-4 text-text-muted" />
            {t('historyCount', { count: resolved.length })}
          </h2>

          {resolved.length === 0 ? (
            <div className="rounded-md border border-border bg-surface p-6 text-center text-sm text-text-muted">
              {t('emptyResolved')}
            </div>
          ) : (
            <ul className="space-y-2">
              {resolved.map((ev) => (
                <EventCard
                  key={ev.id}
                  event={ev}
                  canWrite={canWrite}
                  resolved
                  onReopen={async () => {
                    try {
                      await fiberEventsApi.reopen(ev.id);
                      toast.success(t('toastReopened'));
                      await refresh();
                    } catch (err) {
                      toast.error(
                        err instanceof ApiError
                          ? err.friendlyMessage
                          : tc('error'),
                      );
                    }
                  }}
                  onDelete={() => setDeleting(ev)}
                  onViewPhoto={() => setPhotoViewing(ev)}
                />
              ))}
            </ul>
          )}
        </section>
      </div>

      {creating && (
        <CreateEventDialog
          onClose={() => setCreating(false)}
          onCreated={async () => {
            await refresh();
            setCreating(false);
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          open
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            try {
              await fiberEventsApi.remove(deleting.id);
              toast.success(t('toastDeleted'));
              await refresh();
              setDeleting(null);
            } catch (err) {
              toast.error(
                err instanceof ApiError ? err.friendlyMessage : tc('error'),
              );
            }
          }}
          title={t('deleteTitle')}
          message={t('deleteMessage')}
          confirmLabel={tc('delete')}
          variant="danger"
        />
      )}

      {photoViewing && photoViewing.photoUrl && (
        <Modal
          open
          onClose={() => setPhotoViewing(null)}
          title={t('photoTitle', { code: photoViewing.cable.code })}
          size="lg"
        >
          <img
            src={photoViewing.photoUrl}
            alt={t('photoAlt')}
            className="w-full rounded-md"
          />
        </Modal>
      )}
    </div>
  );
}

// ─── Card de evento ─────────────────────────────────────────────────────────
function EventCard({
  event,
  canWrite,
  resolved,
  onResolve,
  onReopen,
  onDelete,
  onViewPhoto,
}: {
  event: FiberEvent;
  canWrite: boolean;
  resolved?: boolean;
  onResolve?: (notes: string) => void;
  onReopen?: () => void;
  onDelete: () => void;
  onViewPhoto: () => void;
}) {
  const t = useTranslations('network.otdr');
  const tc = useTranslations('common');
  const [resolveOpen, setResolveOpen] = useState(false);
  const [resolveNotes, setResolveNotes] = useState('');
  const km = event.distanceMeters / 1000;

  return (
    <li
      className={`rounded-md border bg-surface p-3 ${
        resolved ? 'border-border opacity-70' : 'border-red-300 dark:border-red-900'
      }`}
    >
      <div className="flex flex-wrap items-start gap-2">
        <Badge tone={TYPE_TONE[event.type]}>{t(`type.${event.type}`)}</Badge>
        <span className="font-mono text-sm">{event.cable.code}</span>
        {event.fiberIndex != null && (
          <span className="text-xs text-text-muted">
            {t('fiberInline', { index: event.fiberIndex })}
          </span>
        )}
        <span className="ml-auto font-mono text-sm">
          {km >= 1 ? `${km.toFixed(3)} km` : `${event.distanceMeters} m`}
        </span>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-text-muted">
        <div>
          <strong>{t('latLng')}:</strong>{' '}
          <span className="font-mono">
            {event.latitude.toFixed(5)}, {event.longitude.toFixed(5)}
          </span>
        </div>
        {event.lossDb != null && (
          <div>
            <strong>Loss:</strong> {event.lossDb.toFixed(2)} dB
          </div>
        )}
        <div>
          <strong>{t('reportedAt')}:</strong>{' '}
          {new Date(event.reportedAt).toLocaleString('pt-BR')}
        </div>
        {resolved && event.resolvedAt && (
          <div>
            <strong>{t('resolvedAt')}:</strong>{' '}
            {new Date(event.resolvedAt).toLocaleString('pt-BR')}
            {event.resolvedBy && (
              <> · {event.resolvedBy.firstName} {event.resolvedBy.lastName}</>
            )}
          </div>
        )}
      </div>

      {event.notes && (
        <p className="mt-2 whitespace-pre-line text-xs text-text">
          {event.notes}
        </p>
      )}

      <div className="mt-2 flex flex-wrap gap-1">
        {event.photoUrl && (
          <Button size="sm" variant="outline" onClick={onViewPhoto}>
            <ImageIcon className="h-3 w-3" /> {t('photo')}
          </Button>
        )}
        {canWrite && !resolved && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setResolveOpen(true)}
          >
            <Check className="h-3 w-3" /> {t('resolve')}
          </Button>
        )}
        {canWrite && resolved && (
          <Button size="sm" variant="outline" onClick={onReopen}>
            <RotateCcw className="h-3 w-3" /> {t('reopen')}
          </Button>
        )}
        {canWrite && (
          <button
            onClick={onDelete}
            className="ml-auto p-1 text-text-muted hover:text-red-600"
            title={tc('delete')}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>

      {resolveOpen && (
        <Modal
          open
          onClose={() => setResolveOpen(false)}
          title={t('resolveTitle')}
          footer={
            <>
              <Button variant="ghost" onClick={() => setResolveOpen(false)}>
                {tc('cancel')}
              </Button>
              <Button
                onClick={() => {
                  onResolve?.(resolveNotes);
                  setResolveOpen(false);
                }}
              >
                {t('markResolved')}
              </Button>
            </>
          }
        >
          <div className="space-y-2">
            <Label>{t('repairNotes')}</Label>
            <Textarea
              rows={3}
              value={resolveNotes}
              onChange={(e) => setResolveNotes(e.target.value)}
              placeholder={t('repairNotesPlaceholder')}
            />
            <FieldHelp>
              {t('repairNotesHelp')}
            </FieldHelp>
          </div>
        </Modal>
      )}
    </li>
  );
}

// ─── Diálogo: criar evento ─────────────────────────────────────────────────
function CreateEventDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const t = useTranslations('network.otdr');
  const tc = useTranslations('common');
  // Cabos disponíveis pra Select.
  const { data: cablesResp } = useSWR<Paginated<FiberCable>>(
    fiberCablesApi.listPath({ pageSize: 500 }),
  );
  const cables = useMemo(() => cablesResp?.data ?? [], [cablesResp]);

  const [cableId, setCableId] = useState('');
  const [distanceKm, setDistanceKm] = useState('');
  const [fiberIndex, setFiberIndex] = useState('');
  const [type, setType] = useState<FiberEventType>('BREAK');
  const [lossDb, setLossDb] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cable = cables.find((c) => c.id === cableId);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!cableId) return setError(t('errChooseCable'));
    const distM = Number(distanceKm) * 1000;
    if (!Number.isFinite(distM) || distM < 0)
      return setError(t('errInvalidDistance'));
    setSubmitting(true);
    setError(null);
    try {
      const payload: CreateFiberEventInput = {
        cableId,
        distanceMeters: Math.round(distM * 100) / 100,
        fiberIndex: fiberIndex ? Number(fiberIndex) : null,
        type,
        lossDb: lossDb ? Number(lossDb) : null,
        photoUrl: photoUrl || null,
        notes: notes || null,
      };
      await fiberEventsApi.create(payload);
      toast.success(t('toastCreated'));
      onCreated();
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
      title={t('createTitle')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            {tc('cancel')}
          </Button>
          <Button onClick={handleSubmit} loading={submitting}>
            {t('register')}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <Label required>{t('cable')}</Label>
          <Select
            value={cableId}
            onChange={(e) => setCableId(e.target.value)}
          >
            <option value="">{t('selectOption')}</option>
            {cables.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} ({(c.lengthMeters / 1000).toFixed(2)} km · {c.fiberCount}f)
              </option>
            ))}
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label required>{t('distanceKm')}</Label>
            <Input
              type="number"
              step={0.001}
              min={0}
              max={cable ? cable.lengthMeters / 1000 : 1000}
              value={distanceKm}
              onChange={(e) => setDistanceKm(e.target.value)}
              placeholder={t('distancePlaceholder')}
            />
            {cable && (
              <FieldHelp>
                {t('distanceHelp', {
                  km: (cable.lengthMeters / 1000).toFixed(3),
                })}
              </FieldHelp>
            )}
          </div>
          <div>
            <Label required>{tc('type')}</Label>
            <Select
              value={type}
              onChange={(e) => setType(e.target.value as FiberEventType)}
            >
              <option value="BREAK">{t('type.BREAK')}</option>
              <option value="BEND">{t('type.BEND')}</option>
              <option value="REFLECTION">{t('type.REFLECTION')}</option>
              <option value="ATTENUATION">{t('type.ATTENUATION')}</option>
              <option value="CONNECTOR">{t('type.CONNECTOR')}</option>
              <option value="OTHER">{t('type.OTHER')}</option>
            </Select>
          </div>
          <div>
            <Label>{t('fiberIndex')}</Label>
            <Input
              type="number"
              min={1}
              max={cable?.fiberCount ?? 432}
              value={fiberIndex}
              onChange={(e) => setFiberIndex(e.target.value)}
              placeholder={cable ? `1..${cable.fiberCount}` : ''}
            />
            <FieldHelp>{t('fiberIndexHelp')}</FieldHelp>
          </div>
          <div>
            <Label>{t('lossDb')}</Label>
            <Input
              type="number"
              step={0.01}
              min={0}
              max={99.99}
              value={lossDb}
              onChange={(e) => setLossDb(e.target.value)}
              placeholder={tc('optional')}
            />
          </div>
        </div>

        <div>
          <Label>{t('photoUrl')}</Label>
          <Input
            type="url"
            value={photoUrl}
            onChange={(e) => setPhotoUrl(e.target.value)}
            placeholder={t('photoUrlPlaceholder')}
          />
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
