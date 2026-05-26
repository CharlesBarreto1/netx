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

const LOSS_LABEL: Record<FiberSpliceLossClass, string> = {
  unmeasured: 'Não medido',
  good: 'OK',
  warning: 'Atenção',
  bad: 'Refazer',
};

export default function FiberSplicesPage() {
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

  if (isLoading && !data) return <PageLoader label="Carregando fusões…" />;

  const rows = data?.data ?? [];

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Fusões / emendas</h1>
          <p className="text-sm text-text-muted">
            Cada ponto onde fibra X do cabo A se conecta com fibra Y do cabo B.
            Loss em dB classifica visualmente o estado (verde / amarelo /
            vermelho).
          </p>
        </div>
        {canWrite && (
          <Button
            onClick={() => setEditing('new')}
            disabled={cables.length < 1}
          >
            <Plus className="h-3.5 w-3.5" />
            Nova fusão
          </Button>
        )}
      </header>

      {cables.length === 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          Cadastre <strong>cabos de fibra</strong> primeiro em{' '}
          <a href="/network/fiber" className="underline">
            Cabos de fibra
          </a>{' '}
          — fusões precisam de pelo menos 1 cabo.
        </div>
      )}

      {/* Filtros */}
      <section className="grid grid-cols-1 gap-3 rounded-md border border-border bg-surface p-4 md:grid-cols-3">
        <div className="md:col-span-2">
          <Label htmlFor="sp-cable">Cabo (filtrar fusões envolvendo)</Label>
          <Select
            id="sp-cable"
            value={cableFilter}
            onChange={(e) => {
              setCableFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Todos os cabos</option>
            {cables.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} ({c.type} · {c.fiberCount} fibras)
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
            Limpar
          </Button>
        </div>
      </section>

      {/* Lista */}
      <div className="overflow-x-auto rounded-md border border-border bg-surface">
        <table className="min-w-full text-sm">
          <thead className="bg-surface-muted text-left text-[11px] font-semibold uppercase tracking-wider text-text-muted">
            <tr>
              <th className="px-3 py-2">Cabo A · Fibra</th>
              <th className="px-3 py-2">↔</th>
              <th className="px-3 py-2">Cabo B · Fibra</th>
              <th className="px-3 py-2">Loss</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2">Medido</th>
              <th className="px-3 py-2">Foto</th>
              <th className="px-3 py-2 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-text-muted">
                  Nenhuma fusão cadastrada com os filtros atuais.
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
                      {LOSS_LABEL[s.lossClass]}
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
                        title="Ver foto"
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
                          title="Editar"
                          className="p-1 text-text-muted hover:text-text"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                      )}
                      {canDelete && (
                        <button
                          onClick={() => setDeleting(s)}
                          title="Excluir"
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
            Página {data.pagination.page} de {data.pagination.totalPages}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= data.pagination.totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Próxima
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
              toast.success('Fusão excluída');
              await mutate();
              setDeleting(null);
            } catch (err) {
              toast.error(
                err instanceof ApiError ? err.friendlyMessage : 'Erro',
              );
            }
          }}
          title="Excluir fusão?"
          message="Histórico do audit log fica preservado."
          confirmLabel="Excluir"
          variant="danger"
        />
      )}

      {viewingPhoto && viewingPhoto.photoUrl && (
        <Modal
          open
          onClose={() => setViewingPhoto(null)}
          title={`Foto — ${viewingPhoto.cableA.code} f${viewingPhoto.fiberAIndex} ↔ ${viewingPhoto.cableB.code} f${viewingPhoto.fiberBIndex}`}
          size="lg"
        >
          <img
            src={viewingPhoto.photoUrl}
            alt="Foto da fusão"
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
      return setError('Escolha cabo A e cabo B');
    if (!location)
      return setError('Marque a localização da fusão no mapa');
    if (cableAId === cableBId && fiberAIndex === fiberBIndex)
      return setError('Fibra não pode ser fundida com ela mesma');
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
      toast.success(isNew ? 'Fusão registrada' : 'Fusão atualizada');
      onSaved();
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
      title={isNew ? 'Nova fusão' : 'Editar fusão'}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} loading={submitting}>
            Salvar
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          {/* Lado A */}
          <div className="space-y-2 rounded-md border border-border bg-surface-muted p-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-text-muted">
              Cabo A
            </div>
            <div>
              <Label htmlFor="sp-cable-a" required>
                Cabo
              </Label>
              <Select
                id="sp-cable-a"
                value={cableAId}
                onChange={(e) => pickCableA(e.target.value)}
              >
                <option value="">—</option>
                {cables.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} ({c.fiberCount}f)
                  </option>
                ))}
              </Select>
            </div>
            {cableA && (
              <div>
                <Label htmlFor="sp-fiber-a" required>
                  Fibra
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
              Cabo B
            </div>
            <div>
              <Label htmlFor="sp-cable-b" required>
                Cabo
              </Label>
              <Select
                id="sp-cable-b"
                value={cableBId}
                onChange={(e) => pickCableB(e.target.value)}
              >
                <option value="">—</option>
                {cables.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} ({c.fiberCount}f)
                  </option>
                ))}
              </Select>
            </div>
            {cableB && (
              <div>
                <Label htmlFor="sp-fiber-b" required>
                  Fibra
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
          <Label required>Localização da fusão</Label>
          <FieldHelp>
            Ponto físico onde foi feita a emenda (caixa de emenda, poste, etc).
          </FieldHelp>
          <LocationPicker value={location} onChange={setLocation} />
        </div>

        <div className="rounded-md border border-border p-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={lossMeasured}
              onChange={(e) => setLossMeasured(e.target.checked)}
            />
            Loss medido (OTDR / fusora)
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
              <FieldHelp>
                Padrão ITU-T ~0.1 dB. &gt; 0.2 dB = atenção. &gt; 0.5 dB = refazer.
              </FieldHelp>
            </div>
          )}
        </div>

        <div>
          <Label htmlFor="sp-photo">Foto (URL)</Label>
          <Input
            id="sp-photo"
            type="url"
            value={photoUrl}
            onChange={(e) => setPhotoUrl(e.target.value)}
            placeholder="https://…"
          />
          <FieldHelp>
            Upload integrado via MinIO chega numa iteração separada
            (StorageModule). Por agora, hospede em qualquer storage e cole a URL.
          </FieldHelp>
        </div>

        <div>
          <Label>Observações</Label>
          <Textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder='Ex.: "tubo verde, sem reparo prévio"'
          />
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}
      </form>
    </Modal>
  );
}
