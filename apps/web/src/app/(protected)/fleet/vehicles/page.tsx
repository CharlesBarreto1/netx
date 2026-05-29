'use client';

import { useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/Button';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { FieldError, Input, Label, Textarea } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import { ApiError, swrFetcher } from '@/lib/api';
import { hasPermission } from '@/lib/session';
import {
  fleetApi,
  VEHICLE_STATUS_LABELS,
  VEHICLE_TYPE_LABELS,
  type CreateVehicleInput,
  type Driver,
  type Paginated,
  type Vehicle,
  type VehicleStatus,
  type VehicleType,
} from '@/lib/fleet-api';

const TYPES: VehicleType[] = ['CAR', 'MOTORCYCLE', 'TRUCK', 'VAN', 'PICKUP', 'OTHER'];
const STATUSES: VehicleStatus[] = ['ACTIVE', 'MAINTENANCE', 'INACTIVE'];

const STATUS_BADGE: Record<VehicleStatus, string> = {
  ACTIVE: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  MAINTENANCE: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  INACTIVE: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
};

export default function FleetVehiclesPage() {
  const { data, isLoading, error, mutate } = useSWR<Paginated<Vehicle>>(
    fleetApi.vehiclesPath({ pageSize: 200 }),
    () => fleetApi.listVehicles({ pageSize: 200 }),
  );
  const canWrite = hasPermission('fleet.write');
  const canDelete = hasPermission('fleet.delete');

  const [editing, setEditing] = useState<Vehicle | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Vehicle | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete(v: Vehicle) {
    setDeleting(true);
    try {
      await fleetApi.deleteVehicle(v.id);
      await mutate();
    } finally {
      setDeleting(false);
      setConfirmDelete(null);
    }
  }

  const rows = data?.data ?? [];

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Veículos</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Frota da operação. O IMEI do rastreador liga o veículo ao Traccar pra aparecer no
            mapa &ldquo;Ao vivo&rdquo;.
          </p>
        </div>
        {canWrite && <Button onClick={() => setCreating(true)}>Novo veículo</Button>}
      </header>

      {isLoading && <PageLoader />}
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          Falha ao carregar veículos.
        </div>
      )}

      {data && rows.length === 0 && (
        <p className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
          Nenhum veículo cadastrado ainda.
        </p>
      )}

      {rows.length > 0 && (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
              <thead className="bg-slate-50 dark:bg-slate-900/40">
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  <th className="px-4 py-3">Placa</th>
                  <th className="px-4 py-3">Veículo</th>
                  <th className="px-4 py-3">Tipo</th>
                  <th className="px-4 py-3">Rastreador</th>
                  <th className="px-4 py-3">Odômetro</th>
                  <th className="px-4 py-3">Motorista</th>
                  <th className="px-4 py-3">Status</th>
                  {canWrite && <th className="px-4 py-3 text-right">Ações</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {rows.map((v) => (
                  <tr key={v.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/60">
                    <td className="px-4 py-3 font-mono font-semibold text-slate-900 dark:text-slate-100">
                      {v.plate}
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                      {[v.brand, v.model].filter(Boolean).join(' ') || <span className="text-slate-400">—</span>}
                      {v.year ? <span className="text-xs text-slate-400"> · {v.year}</span> : null}
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                      {VEHICLE_TYPE_LABELS[v.type]}
                    </td>
                    <td className="px-4 py-3">
                      {v.trackerUniqueId ? (
                        <span className="font-mono text-xs text-slate-600 dark:text-slate-300">
                          {v.trackerUniqueId}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">sem rastreador</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                      {v.odometer.toLocaleString('pt-BR')} km
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                      {v.currentDriver?.name ?? <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs ${STATUS_BADGE[v.status]}`}>
                        {VEHICLE_STATUS_LABELS[v.status]}
                      </span>
                    </td>
                    {canWrite && (
                      <td className="px-4 py-3 text-right">
                        <Button variant="ghost" size="sm" onClick={() => setEditing(v)}>
                          Editar
                        </Button>
                        {canDelete && (
                          <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(v)}>
                            Excluir
                          </Button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {(creating || editing) && (
        <VehicleFormModal
          initial={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={async () => {
            setCreating(false);
            setEditing(null);
            await mutate();
          }}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          open
          title={`Excluir veículo ${confirmDelete.plate}?`}
          message="O veículo é desativado (soft-delete). Despesas e manutenções no histórico ficam preservadas."
          confirmLabel="Excluir"
          loading={deleting}
          onConfirm={() => handleDelete(confirmDelete)}
          onClose={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

function VehicleFormModal({
  initial,
  onClose,
  onSaved,
}: {
  initial: Vehicle | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = !initial;
  const { data: drivers } = useSWR<Paginated<Driver>>(
    fleetApi.driversPath({ status: 'ACTIVE', pageSize: 200 }),
    swrFetcher,
  );
  const [form, setForm] = useState<CreateVehicleInput>({
    plate: initial?.plate ?? '',
    brand: initial?.brand ?? '',
    model: initial?.model ?? '',
    year: initial?.year ?? null,
    type: initial?.type ?? 'CAR',
    color: initial?.color ?? '',
    renavam: initial?.renavam ?? '',
    chassis: initial?.chassis ?? '',
    status: initial?.status ?? 'ACTIVE',
    trackerUniqueId: initial?.trackerUniqueId ?? '',
    odometer: initial?.odometer ?? 0,
    notes: initial?.notes ?? '',
    currentDriverId: initial?.currentDriverId ?? null,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.plate.trim()) return setError('Placa é obrigatória');
    setSubmitting(true);
    try {
      const payload: CreateVehicleInput = {
        ...form,
        brand: form.brand || null,
        model: form.model || null,
        color: form.color || null,
        renavam: form.renavam || null,
        chassis: form.chassis || null,
        trackerUniqueId: form.trackerUniqueId || null,
        notes: form.notes || null,
        currentDriverId: form.currentDriverId || null,
      };
      if (isNew) await fleetApi.createVehicle(payload);
      else await fleetApi.updateVehicle(initial!.id, payload);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.friendlyMessage : 'Erro ao salvar');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={isNew ? 'Novo veículo' : `Editar ${initial!.plate}`}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <Label htmlFor="plate">Placa *</Label>
            <Input
              id="plate"
              value={form.plate}
              onChange={(e) => setForm({ ...form, plate: e.target.value })}
              required
            />
          </div>
          <div>
            <Label htmlFor="type">Tipo</Label>
            <select
              id="type"
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value as VehicleType })}
            >
              {TYPES.map((t) => (
                <option key={t} value={t}>{VEHICLE_TYPE_LABELS[t]}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="status">Status</Label>
            <select
              id="status"
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value as VehicleStatus })}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>{VEHICLE_STATUS_LABELS[s]}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <Label htmlFor="brand">Marca</Label>
            <Input id="brand" value={form.brand ?? ''} onChange={(e) => setForm({ ...form, brand: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="model">Modelo</Label>
            <Input id="model" value={form.model ?? ''} onChange={(e) => setForm({ ...form, model: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="year">Ano</Label>
            <Input
              id="year"
              type="number"
              value={form.year ?? ''}
              onChange={(e) => setForm({ ...form, year: e.target.value ? Number(e.target.value) : null })}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label htmlFor="tracker">IMEI do rastreador (Traccar)</Label>
            <Input
              id="tracker"
              value={form.trackerUniqueId ?? ''}
              onChange={(e) => setForm({ ...form, trackerUniqueId: e.target.value })}
              placeholder="ex. 860000000000001"
            />
          </div>
          <div>
            <Label htmlFor="odometer">Odômetro (km)</Label>
            <Input
              id="odometer"
              type="number"
              value={form.odometer ?? 0}
              onChange={(e) => setForm({ ...form, odometer: e.target.value ? Number(e.target.value) : 0 })}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <Label htmlFor="color">Cor</Label>
            <Input id="color" value={form.color ?? ''} onChange={(e) => setForm({ ...form, color: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="renavam">Renavam</Label>
            <Input id="renavam" value={form.renavam ?? ''} onChange={(e) => setForm({ ...form, renavam: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="driver">Motorista atual</Label>
            <select
              id="driver"
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
              value={form.currentDriverId ?? ''}
              onChange={(e) => setForm({ ...form, currentDriverId: e.target.value || null })}
            >
              <option value="">—</option>
              {(drivers?.data ?? []).map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <Label htmlFor="notes">Observações</Label>
          <Textarea id="notes" rows={2} value={form.notes ?? ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </div>

        {error && <FieldError>{error}</FieldError>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
            Cancelar
          </Button>
          <Button type="submit" loading={submitting}>
            {isNew ? 'Criar' : 'Salvar'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
