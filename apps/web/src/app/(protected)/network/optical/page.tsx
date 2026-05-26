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
import { Plus, Pencil, Trash2, Layers } from 'lucide-react';
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

const TYPES: OpticalEnclosureType[] = ['CTO', 'NAP', 'SPLITTER', 'EMENDA'];

const TYPE_LABEL: Record<OpticalEnclosureType, string> = {
  CTO: 'CTO',
  NAP: 'NAP',
  SPLITTER: 'Splitter',
  EMENDA: 'Emenda',
};

const STATUS_LABEL: Record<OpticalPortStatus, string> = {
  FREE: 'Livre',
  RESERVED: 'Reservada',
  USED: 'Em uso',
  DAMAGED: 'Danificada',
};

const STATUS_TONE: Record<
  OpticalPortStatus,
  'success' | 'warning' | 'info' | 'danger' | 'neutral'
> = {
  FREE: 'success',
  RESERVED: 'warning',
  USED: 'info',
  DAMAGED: 'danger',
};

export default function OpticalEnclosuresPage() {
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

  if (isLoading && !data) return <PageLoader label="Carregando caixas…" />;

  const rows = data?.data ?? [];

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Caixas ópticas</h1>
          <p className="text-sm text-text-muted">
            CTOs, NAPs, splitters e caixas de emenda. Atribua portas a
            contratos pra montar a rede FTTH.
          </p>
        </div>
        {canWrite && (
          <Button onClick={() => setEditing('new')}>
            <Plus className="h-3.5 w-3.5" />
            Nova caixa
          </Button>
        )}
      </header>

      {/* Filtros */}
      <section className="grid grid-cols-1 gap-3 rounded-md border border-border bg-surface p-4 md:grid-cols-4">
        <div className="md:col-span-2">
          <Label htmlFor="opt-search">Buscar</Label>
          <Input
            id="opt-search"
            placeholder="Código ou localização…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div>
          <Label htmlFor="opt-type">Tipo</Label>
          <Select
            id="opt-type"
            value={type}
            onChange={(e) => {
              setType(e.target.value as OpticalEnclosureType | '');
              setPage(1);
            }}
          >
            <option value="">Todos</option>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
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
            Limpar
          </Button>
        </div>
      </section>

      {/* Lista */}
      <div className="overflow-x-auto rounded-md border border-border bg-surface">
        <table className="min-w-full text-sm">
          <thead className="bg-surface-muted text-left text-[11px] font-semibold uppercase tracking-wider text-text-muted">
            <tr>
              <th className="px-3 py-2">Código</th>
              <th className="px-3 py-2">Tipo</th>
              <th className="px-3 py-2">Splitter</th>
              <th className="px-3 py-2">Ocupação</th>
              <th className="px-3 py-2">Localização</th>
              <th className="px-3 py-2 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-text-muted">
                  Nenhuma caixa cadastrada ainda.
                </td>
              </tr>
            ) : (
              rows.map((e) => (
                <tr
                  key={e.id}
                  className="cursor-pointer hover:bg-surface-hover"
                  onClick={() => setShowingPorts(e)}
                >
                  <td className="px-3 py-2 font-medium text-text">{e.code}</td>
                  <td className="px-3 py-2 text-text-muted">
                    {TYPE_LABEL[e.type]}
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
                      <button
                        onClick={(ev) => {
                          ev.stopPropagation();
                          setShowingPorts(e);
                        }}
                        title="Ver portas"
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
                          title="Editar"
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
              toast.success('Caixa excluída');
              await mutate();
              setDeleting(null);
            } catch (err) {
              toast.error(
                err instanceof ApiError ? err.friendlyMessage : 'Erro',
              );
            }
          }}
          title={`Excluir ${deleting.code}?`}
          message="Só permitido se nenhuma porta estiver em uso ou reservada."
          confirmLabel="Excluir"
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
  });
  const [location, setLocation] = useState<LatLng | null>(
    initial ? { latitude: initial.latitude, longitude: initial.longitude } : null,
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    if (!form.code.trim()) return setError('Código obrigatório');
    if (!location) return setError('Marque a localização no mapa');
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
      toast.success(isNew ? 'Caixa criada' : 'Caixa atualizada');
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
      title={isNew ? 'Nova caixa óptica' : `Editar ${initial!.code}`}
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
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <Label required>Código</Label>
            <Input
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              placeholder="CTO-001"
              autoFocus
            />
          </div>
          <div>
            <Label required>Tipo</Label>
            <Select
              value={form.type}
              onChange={(e) =>
                setForm({
                  ...form,
                  type: e.target.value as OpticalEnclosureType,
                })
              }
            >
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t]}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Splitter</Label>
            <Select
              value={form.splitterRatio ?? ''}
              onChange={(e) =>
                setSplitterRatio(
                  (e.target.value as SplitterRatio) || null,
                )
              }
            >
              <option value="">Sem splitter</option>
              {(
                ['ONE_TO_2', 'ONE_TO_4', 'ONE_TO_8', 'ONE_TO_16', 'ONE_TO_32', 'ONE_TO_64'] as SplitterRatio[]
              ).map((r) => (
                <option key={r} value={r}>
                  1:{SPLITTER_OUTPUT_COUNT[r]}
                </option>
              ))}
            </Select>
            <FieldHelp>
              Loss usado depois no power budget (R5).
            </FieldHelp>
          </div>
          <div>
            <Label required>Capacidade (portas)</Label>
            <Input
              type="number"
              min={1}
              max={256}
              value={form.capacity}
              onChange={(e) =>
                setForm({ ...form, capacity: Number(e.target.value) })
              }
            />
            <FieldHelp>
              Portas físicas. Em edit, reduzir capacity só se as portas
              sobressalentes estiverem livres.
            </FieldHelp>
          </div>
          <div>
            <Label>Montagem</Label>
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
              <option value="POSTE">Poste</option>
              <option value="AEREO">Aérea</option>
              <option value="SUBTERRANEO">Subterrânea</option>
              <option value="PAREDE">Parede</option>
              <option value="RACK">Rack</option>
            </Select>
          </div>
          <div>
            <Label>Endereço/marco</Label>
            <Input
              value={form.locationLabel ?? ''}
              onChange={(e) =>
                setForm({ ...form, locationLabel: e.target.value || null })
              }
              placeholder="Poste 027, Av. Mariscal Lopez"
            />
          </div>
        </div>

        <div>
          <Label required>Localização no mapa</Label>
          <FieldHelp>
            Caixa sem coord não aparece no mapa de rede. Use o pino ou
            &quot;Mi ubicación&quot; se estiver em campo.
          </FieldHelp>
          <LocationPicker value={location} onChange={setLocation} />
        </div>

        <div>
          <Label>Observações</Label>
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
          Ativa
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
  const canWrite = hasPermission('network.write');

  const { data: ports, mutate } = useSWR<OpticalPort[]>(
    opticalApi.portsPath(enclosure.id),
  );

  const [editingPort, setEditingPort] = useState<OpticalPort | null>(null);

  return (
    <Modal
      open
      onClose={onClose}
      title={`Portas — ${enclosure.code}`}
      size="lg"
    >
      <div className="space-y-3">
        <div className="text-sm text-text-muted">
          {enclosure.capacity} portas no total.
          {enclosure.splitterRatio
            ? ` Splitter 1:${SPLITTER_OUTPUT_COUNT[enclosure.splitterRatio]}.`
            : ''}
        </div>

        <div className="max-h-[60vh] overflow-y-auto rounded-md border border-border">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 bg-surface-muted text-left text-[11px] font-semibold uppercase tracking-wider text-text-muted">
              <tr>
                <th className="px-3 py-2">#</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Contrato / cliente</th>
                <th className="px-3 py-2">Observação</th>
                <th className="px-3 py-2 text-right">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(ports ?? []).map((p) => (
                <tr key={p.id}>
                  <td className="px-3 py-2 font-mono text-xs">{p.number}</td>
                  <td className="px-3 py-2">
                    <Badge tone={STATUS_TONE[p.status]}>
                      {STATUS_LABEL[p.status]}
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
                        Atribuir
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
      toast.success('Porta atualizada');
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
      title={`Porta ${port.number}`}
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
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <Label required>Status</Label>
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value as OpticalPortStatus)}
          >
            <option value="FREE">Livre</option>
            <option value="RESERVED">Reservada</option>
            <option value="USED">Em uso (atribuir contrato)</option>
            <option value="DAMAGED">Danificada</option>
          </Select>
        </div>

        {status === 'USED' && (
          <div>
            <Label required>Contrato</Label>
            <Input
              placeholder="Buscar por nome ou código…"
              value={contractSearch}
              onChange={(e) => setContractSearch(e.target.value)}
            />
            {contractId && !contractSearch && (
              <div className="mt-1 text-xs text-text-muted">
                Selecionado:{' '}
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
            <FieldHelp>
              Cada contrato ocupa só uma porta — se já estiver em outra,
              o backend recusa.
            </FieldHelp>
          </div>
        )}

        <div>
          <Label>Observação</Label>
          <Textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Ex.: fibra 3 do cabo BB-001"
          />
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}
      </form>
    </Modal>
  );
}
