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

const TYPE_LABEL: Record<FiberEventType, string> = {
  BREAK: 'Rompimento',
  BEND: 'Curva excessiva',
  REFLECTION: 'Reflexão',
  ATTENUATION: 'Atenuação anormal',
  CONNECTOR: 'Conector ruim',
  OTHER: 'Outro',
};

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

  if (isLoading && !activeData) return <PageLoader label="Carregando eventos…" />;

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
            OTDR / Eventos
          </h1>
          <p className="text-sm text-text-muted">
            Operador lê do aparelho a distância do evento e o tipo; sistema
            marca o ponto exato no mapa pra equipe de campo localizar e
            consertar.
          </p>
        </div>
        {canWrite && (
          <Button onClick={() => setCreating(true)}>
            Registrar evento
          </Button>
        )}
      </header>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* ─── Ativos ──────────────────────────────────────────────────────── */}
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <AlertTriangle className="h-4 w-4 text-red-600" />
            Ativos ({active.length})
          </h2>

          {active.length === 0 ? (
            <div className="rounded-md border border-border bg-surface p-6 text-center text-sm text-text-muted">
              ✓ Nenhum evento ativo. Planta operando normal.
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
                      toast.success('Evento resolvido');
                      await refresh();
                    } catch (err) {
                      toast.error(
                        err instanceof ApiError
                          ? err.friendlyMessage
                          : 'Erro',
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
            Histórico ({resolved.length})
          </h2>

          {resolved.length === 0 ? (
            <div className="rounded-md border border-border bg-surface p-6 text-center text-sm text-text-muted">
              Nenhum evento resolvido ainda.
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
                      toast.success('Evento reaberto');
                      await refresh();
                    } catch (err) {
                      toast.error(
                        err instanceof ApiError
                          ? err.friendlyMessage
                          : 'Erro',
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
              toast.success('Evento excluído');
              await refresh();
              setDeleting(null);
            } catch (err) {
              toast.error(
                err instanceof ApiError ? err.friendlyMessage : 'Erro',
              );
            }
          }}
          title="Excluir evento?"
          message="Audit log é preservado. Use 'Reabrir' se foi resolvido por engano."
          confirmLabel="Excluir"
          variant="danger"
        />
      )}

      {photoViewing && photoViewing.photoUrl && (
        <Modal
          open
          onClose={() => setPhotoViewing(null)}
          title={`Foto — ${photoViewing.cable.code}`}
          size="lg"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photoViewing.photoUrl}
            alt="Captura do OTDR ou foto"
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
        <Badge tone={TYPE_TONE[event.type]}>{TYPE_LABEL[event.type]}</Badge>
        <span className="font-mono text-sm">{event.cable.code}</span>
        {event.fiberIndex != null && (
          <span className="text-xs text-text-muted">
            · fibra {event.fiberIndex}
          </span>
        )}
        <span className="ml-auto font-mono text-sm">
          {km >= 1 ? `${km.toFixed(3)} km` : `${event.distanceMeters} m`}
        </span>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-text-muted">
        <div>
          <strong>Lat/Lng:</strong>{' '}
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
          <strong>Reportado:</strong>{' '}
          {new Date(event.reportedAt).toLocaleString('pt-BR')}
        </div>
        {resolved && event.resolvedAt && (
          <div>
            <strong>Resolvido:</strong>{' '}
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
            <ImageIcon className="h-3 w-3" /> Foto
          </Button>
        )}
        {canWrite && !resolved && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setResolveOpen(true)}
          >
            <Check className="h-3 w-3" /> Resolver
          </Button>
        )}
        {canWrite && resolved && (
          <Button size="sm" variant="outline" onClick={onReopen}>
            <RotateCcw className="h-3 w-3" /> Reabrir
          </Button>
        )}
        {canWrite && (
          <button
            onClick={onDelete}
            className="ml-auto p-1 text-text-muted hover:text-red-600"
            title="Excluir"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>

      {resolveOpen && (
        <Modal
          open
          onClose={() => setResolveOpen(false)}
          title="Resolver evento"
          footer={
            <>
              <Button variant="ghost" onClick={() => setResolveOpen(false)}>
                Cancelar
              </Button>
              <Button
                onClick={() => {
                  onResolve?.(resolveNotes);
                  setResolveOpen(false);
                }}
              >
                Marcar como resolvido
              </Button>
            </>
          }
        >
          <div className="space-y-2">
            <Label>Notas do reparo (opcional)</Label>
            <Textarea
              rows={3}
              value={resolveNotes}
              onChange={(e) => setResolveNotes(e.target.value)}
              placeholder="Ex.: fibra refundida no poste 027, loss 0.08 dB"
            />
            <FieldHelp>
              Vai pro histórico do evento e fica visível mesmo após resolvido.
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
    if (!cableId) return setError('Escolha o cabo');
    const distM = Number(distanceKm) * 1000;
    if (!Number.isFinite(distM) || distM < 0)
      return setError('Distância inválida');
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
      toast.success('Evento registrado · pino vermelho no mapa');
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.friendlyMessage : 'Erro');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Registrar evento OTDR"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} loading={submitting}>
            Registrar
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <Label required>Cabo</Label>
          <Select
            value={cableId}
            onChange={(e) => setCableId(e.target.value)}
          >
            <option value="">— selecionar —</option>
            {cables.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} ({(c.lengthMeters / 1000).toFixed(2)} km · {c.fiberCount}f)
              </option>
            ))}
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label required>Distância (km)</Label>
            <Input
              type="number"
              step={0.001}
              min={0}
              max={cable ? cable.lengthMeters / 1000 : 1000}
              value={distanceKm}
              onChange={(e) => setDistanceKm(e.target.value)}
              placeholder="ex.: 1.520"
            />
            {cable && (
              <FieldHelp>
                Cabo tem {(cable.lengthMeters / 1000).toFixed(3)} km. Máximo
                possível.
              </FieldHelp>
            )}
          </div>
          <div>
            <Label required>Tipo</Label>
            <Select
              value={type}
              onChange={(e) => setType(e.target.value as FiberEventType)}
            >
              <option value="BREAK">Rompimento</option>
              <option value="BEND">Curva excessiva</option>
              <option value="REFLECTION">Reflexão</option>
              <option value="ATTENUATION">Atenuação anormal</option>
              <option value="CONNECTOR">Conector ruim</option>
              <option value="OTHER">Outro</option>
            </Select>
          </div>
          <div>
            <Label>Fibra (índice)</Label>
            <Input
              type="number"
              min={1}
              max={cable?.fiberCount ?? 432}
              value={fiberIndex}
              onChange={(e) => setFiberIndex(e.target.value)}
              placeholder={cable ? `1..${cable.fiberCount}` : ''}
            />
            <FieldHelp>Opcional — algumas OTDR não isolam fibra.</FieldHelp>
          </div>
          <div>
            <Label>Loss medido (dB)</Label>
            <Input
              type="number"
              step={0.01}
              min={0}
              max={99.99}
              value={lossDb}
              onChange={(e) => setLossDb(e.target.value)}
              placeholder="opcional"
            />
          </div>
        </div>

        <div>
          <Label>Foto (URL)</Label>
          <Input
            type="url"
            value={photoUrl}
            onChange={(e) => setPhotoUrl(e.target.value)}
            placeholder="https://… (gráfico do OTDR, foto do local)"
          />
        </div>
        <div>
          <Label>Notas</Label>
          <Textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Ex.: cliente relatou queda às 14h, suspeita de fiação cortada"
          />
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}
      </form>
    </Modal>
  );
}
