'use client';

import { Network, Plus, Search, Trash2, Wand2, Download, ArrowRight } from 'lucide-react';
import { useState } from 'react';
import useSWR, { mutate } from 'swr';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { Input, Label, Select, Textarea } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import { Tabs } from '@/components/ui/Tabs';
import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api';
import {
  ipamApi,
  type CgnatPreview,
  type CreateCgnatInput,
  type CreatePrefixInput,
  type IpamAddress,
  type IpamCgnatPlan,
  type IpamLookupResult,
  type IpamPrefix,
} from '@/lib/ipam-api';
import { hasPermission } from '@/lib/session';

type TabKey = 'prefixes' | 'cgnat' | 'lookup';

const ROLE_LABELS: Record<string, string> = {
  SUPERNET: 'Supernet',
  CUSTOMER: 'Cliente (bloco)',
  CGNAT_POOL: 'Bloco CGNAT (privado)',
  PUBLIC_POOL: 'Bloco público',
  MANAGEMENT: 'Gerência',
  LOOPBACK: 'Loopback',
  P2P: 'Ponto-a-ponto',
  DHCP: 'DHCP',
  OTHER: 'Outro',
};
const STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral' | 'info'> = {
  FREE: 'neutral',
  USED: 'success',
  RESERVED: 'warning',
  DHCP: 'info',
  DEPRECATED: 'danger',
};

export default function IpamPage() {
  const [tab, setTab] = useState<TabKey>('prefixes');
  const canWrite = hasPermission('ipam.write');
  const canDelete = hasPermission('ipam.delete');

  return (
    <div className="space-y-5">
      <header className="flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-lg bg-brand-100 text-brand-700 dark:bg-brand-500/20 dark:text-brand-100">
          <Network className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-foreground">IPAM — Documentação de IPs</h1>
          <p className="text-sm text-muted-foreground">
            Prefixos, endereços, pools e CGNAT determinístico, integrados ao cadastro de clientes.
          </p>
        </div>
      </header>

      <Tabs<TabKey>
        value={tab}
        onChange={setTab}
        items={[
          { value: 'prefixes', label: 'Prefixos & IPs' },
          { value: 'cgnat', label: 'CGNAT' },
          { value: 'lookup', label: 'Busca reversa' },
        ]}
      />

      {tab === 'prefixes' && <PrefixesTab canWrite={canWrite} canDelete={canDelete} />}
      {tab === 'cgnat' && <CgnatTab canWrite={canWrite} canDelete={canDelete} />}
      {tab === 'lookup' && <LookupTab />}
    </div>
  );
}

// =============================================================================
// PREFIXOS & ENDEREÇOS
// =============================================================================
function PrefixesTab({ canWrite, canDelete }: { canWrite: boolean; canDelete: boolean }) {
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<IpamPrefix | null>(null);
  const [showNew, setShowNew] = useState(false);
  const { data: prefixes, isLoading } = useSWR(['ipam-prefixes', q], () =>
    ipamApi.listPrefixes({ q: q || undefined }),
  );

  if (isLoading) return <PageLoader />;

  return (
    <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar CIDR ou descrição…"
              className="pl-8"
            />
          </div>
          {canWrite && (
            <Button onClick={() => setShowNew(true)}>
              <Plus className="mr-1 h-4 w-4" /> Prefixo
            </Button>
          )}
        </div>

        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">CIDR</th>
                <th className="px-3 py-2">Papel</th>
                <th className="px-3 py-2">VLAN</th>
                <th className="px-3 py-2">Uso</th>
              </tr>
            </thead>
            <tbody>
              {(prefixes ?? []).map((p) => (
                <tr
                  key={p.id}
                  onClick={() => setSelected(p)}
                  className={`cursor-pointer border-t border-border hover:bg-surface-muted ${
                    selected?.id === p.id ? 'bg-brand-50 dark:bg-brand-500/10' : ''
                  }`}
                >
                  <td className="px-3 py-2 font-mono">
                    {p.cidr}{' '}
                    <Badge tone={p.version === 'V6' ? 'purple' : 'info'}>{p.version}</Badge>
                  </td>
                  <td className="px-3 py-2">{ROLE_LABELS[p.role] ?? p.role}</td>
                  <td className="px-3 py-2">{p.vlanId ?? '—'}</td>
                  <td className="px-3 py-2">
                    {p.utilization != null ? (
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-16 overflow-hidden rounded bg-surface-muted">
                          <div
                            className="h-full bg-brand-500"
                            style={{ width: `${Math.min(100, p.utilization)}%` }}
                          />
                        </div>
                        <span className="text-xs text-muted-foreground">{p.utilization}%</span>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">{p.usedCount} usados</span>
                    )}
                  </td>
                </tr>
              ))}
              {!prefixes?.length && (
                <tr>
                  <td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">
                    Nenhum prefixo cadastrado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        {selected ? (
          <AddressesPanel prefix={selected} canWrite={canWrite} canDelete={canDelete} />
        ) : (
          <div className="grid h-full min-h-40 place-items-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
            Selecione um prefixo para ver os IPs.
          </div>
        )}
      </section>

      {showNew && (
        <NewPrefixModal
          onClose={() => setShowNew(false)}
          onCreated={() => {
            setShowNew(false);
            mutate(['ipam-prefixes', q]);
          }}
        />
      )}
    </div>
  );
}

function AddressesPanel({
  prefix,
  canWrite,
  canDelete,
}: {
  prefix: IpamPrefix;
  canWrite: boolean;
  canDelete: boolean;
}) {
  const key = ['ipam-addresses', prefix.id];
  const { data: addresses, isLoading } = useSWR(key, () =>
    ipamApi.listAddresses({ prefixId: prefix.id }),
  );
  const [busy, setBusy] = useState(false);
  const [releasing, setReleasing] = useState<IpamAddress | null>(null);

  const allocate = async () => {
    setBusy(true);
    try {
      const a = await ipamApi.allocate({ prefixId: prefix.id, description: 'Alocado via IPAM' });
      toast.success(`IP alocado: ${a.address}`);
      mutate(key);
      mutate(['ipam-prefixes', '']);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.problem.detail ?? e.problem.title : 'Falha ao alocar');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-border">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div>
          <div className="font-mono text-sm font-medium">{prefix.cidr}</div>
          <div className="text-xs text-muted-foreground">
            {prefix.usedCount} usados de {prefix.usableHosts} úteis
          </div>
        </div>
        {canWrite && (
          <Button variant="secondary" size="sm" onClick={allocate} disabled={busy}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Próximo livre
          </Button>
        )}
      </div>
      {isLoading ? (
        <div className="p-4">
          <PageLoader />
        </div>
      ) : (
        <div className="max-h-[460px] overflow-auto">
          <table className="w-full text-sm">
            <tbody>
              {(addresses ?? []).map((a) => (
                <tr key={a.id} className="border-t border-border">
                  <td className="px-3 py-2 font-mono">{a.address}</td>
                  <td className="px-3 py-2">
                    <Badge tone={STATUS_TONE[a.status] ?? 'neutral'}>{a.status}</Badge>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {a.contract?.code
                      ? `Contrato ${a.contract.code}`
                      : a.customer?.displayName
                        ? a.customer.displayName
                        : a.equipment?.name
                          ? a.equipment.name
                          : a.description ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {canDelete && a.status !== 'FREE' && (
                      <button
                        onClick={() => setReleasing(a)}
                        className="text-muted-foreground hover:text-danger"
                        title="Liberar"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!addresses?.length && (
                <tr>
                  <td className="px-3 py-6 text-center text-muted-foreground">Nenhum IP documentado.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {releasing && (
        <ConfirmDialog
          open
          title="Liberar IP"
          message={`Liberar ${releasing.address}? Ele volta a ficar disponível.`}
          onClose={() => setReleasing(null)}
          onConfirm={async () => {
            await ipamApi.releaseAddress(releasing.id);
            setReleasing(null);
            mutate(key);
            toast.success('IP liberado');
          }}
        />
      )}
    </div>
  );
}

function NewPrefixModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState<CreatePrefixInput>({ cidr: '', role: 'OTHER' });
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await ipamApi.createPrefix({
        ...form,
        vlanId: form.vlanId ? Number(form.vlanId) : null,
      });
      toast.success('Prefixo criado');
      onCreated();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.problem.detail ?? e.problem.title : 'Falha ao criar');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Novo prefixo">
      <div className="space-y-3">
        <div>
          <Label>CIDR (IPv4 ou IPv6)</Label>
          <Input
            value={form.cidr}
            onChange={(e) => setForm({ ...form, cidr: e.target.value })}
            placeholder="10.0.0.0/24 ou 2001:db8::/48"
            className="font-mono"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Papel</Label>
            <Select
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value as CreatePrefixInput['role'] })}
            >
              {Object.entries(ROLE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>VLAN (opcional)</Label>
            <Input
              type="number"
              value={form.vlanId ?? ''}
              onChange={(e) => setForm({ ...form, vlanId: e.target.value ? Number(e.target.value) : null })}
            />
          </div>
        </div>
        <div>
          <Label>Descrição</Label>
          <Textarea
            value={form.description ?? ''}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={2}
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={busy || !form.cidr}>
            Criar
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// =============================================================================
// CGNAT
// =============================================================================
function CgnatTab({ canWrite, canDelete }: { canWrite: boolean; canDelete: boolean }) {
  const { data: plans, isLoading } = useSWR('ipam-cgnat', ipamApi.listCgnat);
  const [selected, setSelected] = useState<IpamCgnatPlan | null>(null);
  const [showNew, setShowNew] = useState(false);

  if (isLoading) return <PageLoader />;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
      <section className="space-y-3">
        <div className="flex justify-end">
          {canWrite && (
            <Button onClick={() => setShowNew(true)}>
              <Plus className="mr-1 h-4 w-4" /> Plano CGNAT
            </Button>
          )}
        </div>
        <div className="space-y-2">
          {(plans ?? []).map((p) => (
            <button
              key={p.id}
              onClick={() => setSelected(p)}
              className={`w-full rounded-lg border border-border p-3 text-left hover:bg-surface-muted ${
                selected?.id === p.id ? 'ring-2 ring-brand-500' : ''
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">{p.name}</span>
                <span className="text-xs text-muted-foreground">{p.portsPerClient} portas/cliente</span>
              </div>
              <div className="mt-1 flex items-center gap-1 font-mono text-xs text-muted-foreground">
                {p.cgnatPrefix?.cidr} <ArrowRight className="h-3 w-3" /> {p.publicPrefix?.cidr}
              </div>
            </button>
          ))}
          {!plans?.length && (
            <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              Nenhum plano CGNAT.
            </div>
          )}
        </div>
      </section>

      <section>
        {selected ? (
          <CgnatDetail plan={selected} canWrite={canWrite} canDelete={canDelete} onDeleted={() => setSelected(null)} />
        ) : (
          <div className="grid h-full min-h-40 place-items-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
            Selecione um plano para ver o mapeamento.
          </div>
        )}
      </section>

      {showNew && (
        <NewCgnatModal
          onClose={() => setShowNew(false)}
          onCreated={() => {
            setShowNew(false);
            mutate('ipam-cgnat');
          }}
        />
      )}
    </div>
  );
}

function CgnatDetail({
  plan,
  canWrite,
  canDelete,
  onDeleted,
}: {
  plan: IpamCgnatPlan;
  canWrite: boolean;
  canDelete: boolean;
  onDeleted: () => void;
}) {
  const [offset, setOffset] = useState(0);
  const { data: preview } = useSWR<CgnatPreview>([`ipam-cgnat-preview`, plan.id, offset], () =>
    ipamApi.previewCgnat(plan.id, offset, 50),
  );
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const cap = preview?.capacity;

  const materialize = async () => {
    setBusy(true);
    try {
      const r = await ipamApi.materializeCgnat(plan.id);
      toast.success(`${r.entryCount} entradas materializadas`);
      mutate('ipam-cgnat');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.problem.detail ?? e.problem.title : 'Falha');
    } finally {
      setBusy(false);
    }
  };

  const doExport = async (format: 'csv' | 'mikrotik') => {
    try {
      const text = await ipamApi.exportCgnat(plan.id, format);
      const blob = new Blob([text], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cgnat-${plan.name}.${format === 'csv' ? 'csv' : 'rsc'}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.problem.detail ?? e.problem.title : 'Falha ao exportar');
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-medium">{plan.name}</div>
          <div className="font-mono text-xs text-muted-foreground">
            {plan.cgnatPrefix?.cidr} → {plan.publicPrefix?.cidr} · portas {plan.portBase}–{plan.maxPort}
          </div>
        </div>
        <div className="flex gap-2">
          {canWrite && (
            <Button size="sm" onClick={materialize} disabled={busy}>
              <Wand2 className="mr-1 h-3.5 w-3.5" /> Materializar
            </Button>
          )}
          <Button size="sm" variant="secondary" onClick={() => doExport('csv')}>
            <Download className="mr-1 h-3.5 w-3.5" /> CSV
          </Button>
          <Button size="sm" variant="secondary" onClick={() => doExport('mikrotik')}>
            <Download className="mr-1 h-3.5 w-3.5" /> Mikrotik
          </Button>
        </div>
      </div>

      {cap && (
        <div className="flex flex-wrap gap-3 rounded-md bg-surface-muted p-2 text-xs">
          <span>Blocos/IP público: <b>{cap.blocksPerPublicIp}</b></span>
          <span>Capacidade: <b>{cap.capacity}</b></span>
          <span>Clientes CGNAT: <b>{cap.cgnatCount}</b></span>
          <Badge tone={cap.sufficient ? 'success' : 'danger'}>
            {cap.sufficient ? `Sobra ${cap.spare}` : `Falta ${cap.spare}`}
          </Badge>
        </div>
      )}

      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface-muted text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2">IP privado</th>
              <th className="px-3 py-2">IP público</th>
              <th className="px-3 py-2">Portas</th>
            </tr>
          </thead>
          <tbody>
            {(preview?.rows ?? []).map((r) => (
              <tr key={r.privateIp} className="border-t border-border font-mono">
                <td className="px-3 py-1.5">{r.privateIp}</td>
                <td className="px-3 py-1.5">{r.publicIp}</td>
                <td className="px-3 py-1.5">
                  {r.portStart}–{r.portEnd}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {preview ? `${offset + 1}–${offset + preview.rows.length} de ${preview.total}` : ''}
        </span>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - 50))}
          >
            Anterior
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={!!preview && offset + preview.rows.length >= Number(preview.total)}
            onClick={() => setOffset(offset + 50)}
          >
            Próxima
          </Button>
          {canDelete && (
            <Button size="sm" variant="danger" onClick={() => setConfirmDel(true)}>
              Excluir plano
            </Button>
          )}
        </div>
      </div>

      {confirmDel && (
        <ConfirmDialog
          open
          title="Excluir plano CGNAT"
          message={`Excluir "${plan.name}" e todas as entradas materializadas?`}
          onClose={() => setConfirmDel(false)}
          variant="danger"
          onConfirm={async () => {
            await ipamApi.deleteCgnat(plan.id);
            setConfirmDel(false);
            onDeleted();
            mutate('ipam-cgnat');
            toast.success('Plano excluído');
          }}
        />
      )}
    </div>
  );
}

function NewCgnatModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { data: prefixes } = useSWR('ipam-prefixes-all', () => ipamApi.listPrefixes());
  const v4 = (prefixes ?? []).filter((p) => p.version === 'V4');
  const publicPrefixes = v4.filter((p) => p.role === 'PUBLIC_POOL' || p.role === 'SUPERNET');
  const cgnatPrefixes = v4.filter((p) => p.role === 'CGNAT_POOL');
  const [form, setForm] = useState<CreateCgnatInput>({
    name: '',
    publicPrefixId: '',
    cgnatPrefixId: '',
    portsPerClient: 1000,
    portBase: 1024,
    maxPort: 65535,
  });
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await ipamApi.createCgnat(form);
      toast.success('Plano CGNAT criado');
      onCreated();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.problem.detail ?? e.problem.title : 'Falha ao criar');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Novo plano CGNAT">
      <div className="space-y-3">
        <div>
          <Label>Nome</Label>
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Bloco público (saída)</Label>
            <Select
              value={form.publicPrefixId}
              onChange={(e) => setForm({ ...form, publicPrefixId: e.target.value })}
            >
              <option value="">Selecione…</option>
              {publicPrefixes.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.cidr}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Bloco CGNAT (privado)</Label>
            <Select
              value={form.cgnatPrefixId}
              onChange={(e) => setForm({ ...form, cgnatPrefixId: e.target.value })}
            >
              <option value="">Selecione…</option>
              {cgnatPrefixes.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.cidr}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label>Portas/cliente</Label>
            <Input
              type="number"
              value={form.portsPerClient}
              onChange={(e) => setForm({ ...form, portsPerClient: Number(e.target.value) })}
            />
          </div>
          <div>
            <Label>Porta inicial</Label>
            <Input
              type="number"
              value={form.portBase}
              onChange={(e) => setForm({ ...form, portBase: Number(e.target.value) })}
            />
          </div>
          <div>
            <Label>Porta final</Label>
            <Input
              type="number"
              value={form.maxPort}
              onChange={(e) => setForm({ ...form, maxPort: Number(e.target.value) })}
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Dica: cadastre os prefixos com papel <b>Bloco público</b> e <b>Bloco CGNAT (privado)</b> antes.
        </p>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={busy || !form.name || !form.publicPrefixId || !form.cgnatPrefixId}>
            Criar
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// =============================================================================
// BUSCA REVERSA (Marco Civil)
// =============================================================================
function LookupTab() {
  const [ip, setIp] = useState('');
  const [port, setPort] = useState('');
  const [at, setAt] = useState('');
  const [result, setResult] = useState<IpamLookupResult | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (!ip) return;
    setBusy(true);
    try {
      const r = await ipamApi.lookup(ip, port || undefined, at ? new Date(at).toISOString() : undefined);
      setResult(r);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.problem.detail ?? e.problem.title : 'Falha na busca');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-4">
      <div className="rounded-lg border border-border p-4">
        <p className="mb-3 text-sm text-muted-foreground">
          Descubra qual cliente estava usando um IP (público + porta) num instante — cruza IPAM,
          CGNAT e sessões RADIUS. Útil para responder ofícios (Marco Civil).
        </p>
        <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1.5fr_auto] sm:items-end">
          <div>
            <Label>IP</Label>
            <Input value={ip} onChange={(e) => setIp(e.target.value)} placeholder="203.0.113.10" className="font-mono" />
          </div>
          <div>
            <Label>Porta</Label>
            <Input value={port} onChange={(e) => setPort(e.target.value)} placeholder="34567" type="number" />
          </div>
          <div>
            <Label>Data/hora</Label>
            <Input value={at} onChange={(e) => setAt(e.target.value)} type="datetime-local" />
          </div>
          <Button onClick={run} disabled={busy || !ip}>
            <Search className="mr-1 h-4 w-4" /> Buscar
          </Button>
        </div>
      </div>

      {result && (
        <div className="space-y-3 rounded-lg border border-border p-4">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Resultado para</span>
            <span className="font-mono text-sm">
              {result.query.ip}
              {result.query.port != null ? `:${result.query.port}` : ''}
            </span>
          </div>

          {result.resolved.contract || result.resolved.customer ? (
            <div className="rounded-md bg-emerald-50 p-3 text-sm dark:bg-emerald-900/20">
              <div className="font-medium text-emerald-800 dark:text-emerald-300">
                Cliente identificado ({result.resolved.via})
              </div>
              <div className="mt-1">
                {result.resolved.customer?.displayName ?? '—'}
                {result.resolved.contract?.code ? ` · Contrato ${result.resolved.contract.code}` : ''}
              </div>
            </div>
          ) : (
            <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
              Nenhum cliente resolvido diretamente. Veja as sessões RADIUS abaixo.
            </div>
          )}

          {result.cgnatMatch && (
            <div className="text-sm">
              <span className="text-muted-foreground">CGNAT ({result.cgnatMatch.source}): </span>
              <span className="font-mono">
                público → privado {result.cgnatMatch.privateIp}
                {result.cgnatMatch.portStart != null
                  ? ` (portas ${result.cgnatMatch.portStart}–${result.cgnatMatch.portEnd})`
                  : ''}
              </span>
            </div>
          )}

          <div>
            <div className="mb-1 text-xs uppercase text-muted-foreground">
              Sessões RADIUS (IP {result.radiusIp})
            </div>
            {result.radiusSessions.length ? (
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="py-1">Usuário</th>
                    <th className="py-1">Início</th>
                    <th className="py-1">Fim</th>
                    <th className="py-1">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {result.radiusSessions.map((s, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="py-1 font-mono">{s.username ?? '—'}</td>
                      <td className="py-1">{s.sessionStart ? new Date(s.sessionStart).toLocaleString() : '—'}</td>
                      <td className="py-1">{s.sessionStop ? new Date(s.sessionStop).toLocaleString() : '—'}</td>
                      <td className="py-1">
                        <Badge tone={s.online ? 'success' : 'neutral'}>{s.online ? 'online' : 'encerrada'}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="text-sm text-muted-foreground">Sem sessão RADIUS para esse IP/horário.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
