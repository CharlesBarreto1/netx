'use client';

import { Plus, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import useSWR from 'swr';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { FieldHelp, Input, Label, Select, Textarea } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api';
import {
  networkApi,
  type EquipmentType,
  type EquipmentVendor,
  type NetworkEquipment,
  type NetworkPop,
  type CreateEquipmentInput,
} from '@/lib/network-api';
import { hasPermission } from '@/lib/session';

const TYPES: EquipmentType[] = ['BNG', 'OLT', 'ROUTER', 'SWITCH', 'OTHER'];
const TYPE_LABEL: Record<EquipmentType, string> = {
  BNG: 'BNG',
  OLT: 'OLT',
  ROUTER: 'Router',
  SWITCH: 'Switch',
  OTHER: 'Otro',
};
const TYPE_TONE: Record<EquipmentType, 'success' | 'info' | 'warning' | 'neutral'> = {
  BNG: 'success',
  OLT: 'info',
  ROUTER: 'warning',
  SWITCH: 'neutral',
  OTHER: 'neutral',
};
const VENDORS: EquipmentVendor[] = [
  'MIKROTIK',
  'HUAWEI',
  'ZTE',
  'FIBERHOME',
  'CISCO',
  'JUNIPER',
  'OTHER',
];

export default function EquipmentPage() {
  const canWrite = hasPermission('network.write');
  const canDelete = hasPermission('network.delete');

  const [typeFilter, setTypeFilter] = useState<EquipmentType | ''>('');
  const { data, isLoading, mutate } = useSWR<NetworkEquipment[]>(
    networkApi.equipmentListPath(typeFilter ? { type: typeFilter } : undefined),
  );
  const { data: pops } = useSWR<NetworkPop[]>(networkApi.popsListPath());
  const [editing, setEditing] = useState<NetworkEquipment | 'new' | null>(null);
  const [deleting, setDeleting] = useState<NetworkEquipment | null>(null);

  if (isLoading && !data) return <PageLoader />;
  const items = data ?? [];

  async function resync() {
    try {
      const res = await networkApi.resyncBngs();
      toast.success(`Resync completo: ${res.synced}/${res.totalBngs} BNGs`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.friendlyMessage : 'Error');
    }
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Equipamientos</h1>
          <p className="text-sm text-text-muted">
            BNGs, OLTs, routers y switches del datacenter. BNGs se registran
            automáticamente en RADIUS.
          </p>
        </div>
        <div className="flex gap-2">
          {canWrite && (
            <Button variant="outline" size="sm" onClick={resync} title="Forçar resync de BNGs com radius.nas">
              <RefreshCw className="h-3.5 w-3.5" />
              Resync RADIUS
            </Button>
          )}
          {canWrite && (
            <Button onClick={() => setEditing('new')}>
              <Plus className="h-3.5 w-3.5" />
              Nuevo equipo
            </Button>
          )}
        </div>
      </header>

      <div className="flex gap-3">
        <Select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as EquipmentType | '')}
          className="w-44"
        >
          <option value="">Todos los tipos</option>
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </Select>
      </div>

      <div className="overflow-x-auto rounded-md border border-border bg-surface">
        <table className="min-w-full text-sm">
          <thead className="bg-surface-muted text-left text-[11px] font-semibold uppercase tracking-wider text-text-muted">
            <tr>
              <th className="px-3 py-2">Tipo</th>
              <th className="px-3 py-2">Nombre</th>
              <th className="px-3 py-2">Vendor</th>
              <th className="px-3 py-2">IP</th>
              <th className="px-3 py-2">POP</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-text-muted">
                  Sin equipamientos.
                </td>
              </tr>
            ) : (
              items.map((e) => (
                <tr key={e.id} className="hover:bg-surface-hover">
                  <td className="px-3 py-2">
                    <Badge tone={TYPE_TONE[e.type]}>{TYPE_LABEL[e.type]}</Badge>
                  </td>
                  <td className="px-3 py-2 font-medium">{e.name}</td>
                  <td className="px-3 py-2 text-xs text-text-muted">{e.vendor}</td>
                  <td className="px-3 py-2 font-mono text-xs">{e.ipAddress}</td>
                  <td className="px-3 py-2 text-xs text-text-muted">
                    {e.pop?.name ?? '—'}
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={e.isActive ? 'success' : 'neutral'}>
                      {e.isActive ? 'Activo' : 'Inactivo'}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {canWrite && (
                      <Button size="xs" variant="ghost" onClick={() => setEditing(e)}>
                        Editar
                      </Button>
                    )}
                    {canDelete && (
                      <Button size="xs" variant="ghost" onClick={() => setDeleting(e)}>
                        Eliminar
                      </Button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <EquipmentFormDialog
          initial={editing === 'new' ? null : editing}
          pops={pops ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            void mutate();
            setEditing(null);
          }}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await networkApi.deleteEquipment(deleting.id);
            toast.success('Equipo eliminado');
            setDeleting(null);
            await mutate();
          } catch (err) {
            toast.error(err instanceof ApiError ? err.friendlyMessage : 'Error');
          }
        }}
        title="Eliminar equipamiento"
        message={
          deleting?.type === 'BNG'
            ? `Eliminar BNG "${deleting?.name}"? La entrada en radius.nas también será removida.`
            : `Eliminar "${deleting?.name}"?`
        }
        confirmLabel="Eliminar"
        variant="danger"
      />
    </div>
  );
}

function EquipmentFormDialog({
  initial,
  pops,
  onClose,
  onSaved,
}: {
  initial: NetworkEquipment | null;
  pops: NetworkPop[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = !initial;
  const [form, setForm] = useState<CreateEquipmentInput>({
    type: initial?.type ?? 'BNG',
    vendor: initial?.vendor ?? 'MIKROTIK',
    name: initial?.name ?? '',
    hostname: initial?.hostname ?? '',
    ipAddress: initial?.ipAddress ?? '',
    popId: initial?.popId ?? null,
    radiusSecret: initial?.radiusSecret ?? '',
    radiusNasType: initial?.radiusNasType ?? 'mikrotik',
    snmpCommunity: initial?.snmpCommunity ?? '',
    snmpVersion: initial?.snmpVersion ?? 'v2c',
    notes: initial?.notes ?? '',
    isActive: initial?.isActive ?? true,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return setError('Nombre obligatorio');
    if (!form.ipAddress.trim()) return setError('IP obligatorio');
    if (form.type === 'BNG' && (!form.radiusSecret || form.radiusSecret.length < 4)) {
      return setError('BNG exige radiusSecret (mín. 4 chars)');
    }
    setSubmitting(true);
    try {
      if (isNew) {
        await networkApi.createEquipment(form);
      } else {
        await networkApi.updateEquipment(initial!.id, form);
      }
      toast.success(isNew ? 'Equipo creado' : 'Equipo actualizado');
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.friendlyMessage : 'Error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? 'Nuevo equipamiento' : `Editar ${initial!.name}`}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} loading={submitting}>
            Guardar
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <Label required>Tipo</Label>
            <Select
              value={form.type}
              onChange={(e) =>
                setForm({ ...form, type: e.target.value as EquipmentType })
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
            <Label>Vendor</Label>
            <Select
              value={form.vendor}
              onChange={(e) =>
                setForm({ ...form, vendor: e.target.value as EquipmentVendor })
              }
            >
              {VENDORS.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <Label required>Nombre</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="BNG-Asuncion-01"
              autoFocus
            />
          </div>
          <div>
            <Label>Hostname</Label>
            <Input
              value={form.hostname}
              onChange={(e) => setForm({ ...form, hostname: e.target.value })}
              placeholder="bng01.netx.local"
            />
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <Label required>IP de management</Label>
            <Input
              value={form.ipAddress}
              onChange={(e) => setForm({ ...form, ipAddress: e.target.value })}
              placeholder="10.33.33.102"
            />
            <FieldHelp>
              Mismo IP que el equipo usa pra mandar Access-Request al RADIUS.
            </FieldHelp>
          </div>
          <div>
            <Label>POP</Label>
            <Select
              value={form.popId ?? ''}
              onChange={(e) =>
                setForm({ ...form, popId: e.target.value || null })
              }
            >
              <option value="">— Sin POP —</option>
              {pops.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {/* Bloco RADIUS — só pra BNG */}
        {form.type === 'BNG' && (
          <div className="rounded-md border border-dashed border-border bg-surface-muted p-3 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">
              RADIUS
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <Label required>Shared secret</Label>
                <Input
                  value={form.radiusSecret}
                  onChange={(e) =>
                    setForm({ ...form, radiusSecret: e.target.value })
                  }
                  placeholder="el mismo configurado en el BNG"
                />
                <FieldHelp>
                  Idéntico al secret del NAS. Cambio invalida sesiones existentes.
                </FieldHelp>
              </div>
              <div>
                <Label>Tipo NAS</Label>
                <Select
                  value={form.radiusNasType ?? 'mikrotik'}
                  onChange={(e) =>
                    setForm({ ...form, radiusNasType: e.target.value })
                  }
                >
                  <option value="mikrotik">mikrotik</option>
                  <option value="cisco">cisco</option>
                  <option value="juniper">juniper</option>
                  <option value="huawei">huawei</option>
                  <option value="other">other</option>
                </Select>
              </div>
            </div>
            <p className="rounded bg-surface px-2 py-1.5 text-xs text-text-muted">
              Al guardar, NetX inserta/actualiza esto en{' '}
              <code className="font-mono">radius.nas</code>. Tu BNG es reconocido
              por FreeRADIUS al instante.
            </p>
          </div>
        )}

        {/* Bloco SNMP — pra OLT/Router (futuro) */}
        {(form.type === 'OLT' || form.type === 'ROUTER' || form.type === 'SWITCH') && (
          <div className="rounded-md border border-dashed border-border bg-surface-muted p-3 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">
              SNMP (opcional)
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <Label>Community</Label>
                <Input
                  value={form.snmpCommunity}
                  onChange={(e) =>
                    setForm({ ...form, snmpCommunity: e.target.value })
                  }
                  placeholder="public"
                />
              </div>
              <div>
                <Label>Versión</Label>
                <Select
                  value={form.snmpVersion ?? 'v2c'}
                  onChange={(e) =>
                    setForm({ ...form, snmpVersion: e.target.value })
                  }
                >
                  <option value="v2c">v2c</option>
                  <option value="v3">v3</option>
                </Select>
              </div>
            </div>
          </div>
        )}

        <div>
          <Label>Observaciones</Label>
          <Textarea
            rows={2}
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </div>
        <div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.isActive ?? true}
              onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
            />
            Activo
          </label>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </form>
    </Modal>
  );
}
