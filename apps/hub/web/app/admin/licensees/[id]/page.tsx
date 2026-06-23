'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { adminApi, adminToken, date, money, HubApiError } from '@/lib/api';
import { Badge, Card, Field, inputCls } from '@/components/ui';

export default function LicenseeDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [lic, setLic] = useState<any>(null);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    try {
      const [l, inv] = await Promise.all([adminApi.getLicensee(id), adminApi.listInvoices(id)]);
      setLic(l);
      setInvoices(inv);
    } catch (e) {
      if (e instanceof HubApiError && e.status === 401) router.replace('/admin/login');
      else setErr('Falha ao carregar.');
    }
  }
  useEffect(() => {
    if (!adminToken.get()) router.replace('/admin/login');
    else void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function flash(m: string) {
    setMsg(m);
    setTimeout(() => setMsg(null), 6000);
  }

  if (!lic) return <main className="px-6 py-8 text-sm text-slate-500">{err ?? 'Carregando…'}</main>;

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <Link href="/admin" className="text-sm text-blue-700 hover:underline">← Clientes</Link>
      <h1 className="mb-1 mt-2 text-xl font-bold">{lic.name}</h1>
      <p className="mb-6 text-sm text-slate-500">{lic.taxId ?? 'sem documento'} · {lic.plan}</p>

      {msg && <p className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{msg}</p>}
      {err && <p className="mb-4 text-sm text-red-600">{err}</p>}

      <div className="flex flex-col gap-5">
        <LicenseeForm lic={lic} onSaved={(m) => { flash(m); void load(); }} />
        <InstancesCard lic={lic} onChange={(m) => { flash(m); void load(); }} />
        <InvoicesCard licenseeId={id} invoices={invoices} onChange={(m) => { flash(m); void load(); }} />
        <HubUsersCard lic={lic} onChange={(m) => { flash(m); void load(); }} />
      </div>
    </main>
  );
}

function LicenseeForm({ lic, onSaved }: { lic: any; onSaved: (m: string) => void }) {
  const [f, setF] = useState({
    name: lic.name ?? '',
    taxId: lic.taxId ?? '',
    contactEmail: lic.contactEmail ?? '',
    phone: lic.phone ?? '',
    addressLine: lic.addressLine ?? '',
    city: lic.city ?? '',
    state: lic.state ?? '',
    pricePerContractCents: String(lic.pricePerContractCents ?? 0),
    billingDay: String(lic.billingDay ?? 10),
    billingActive: !!lic.billingActive,
  });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: any) => setF((p) => ({ ...p, [k]: v }));

  async function save() {
    setSaving(true);
    try {
      await adminApi.updateLicensee(lic.id, {
        name: f.name,
        taxId: f.taxId || undefined,
        contactEmail: f.contactEmail || undefined,
        phone: f.phone || undefined,
        addressLine: f.addressLine || undefined,
        city: f.city || undefined,
        state: f.state || undefined,
        pricePerContractCents: parseInt(f.pricePerContractCents, 10) || 0,
        billingDay: parseInt(f.billingDay, 10) || 10,
        billingActive: f.billingActive,
      });
      onSaved('Dados do cliente atualizados.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card title="Dados do cliente" action={
      <button onClick={save} disabled={saving} className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
        {saving ? 'Salvando…' : 'Salvar'}
      </button>
    }>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Nome"><input value={f.name} onChange={(e) => set('name', e.target.value)} className={inputCls} /></Field>
        <Field label="CNPJ / RUC"><input value={f.taxId} onChange={(e) => set('taxId', e.target.value)} className={inputCls} /></Field>
        <Field label="E-mail de contato"><input value={f.contactEmail} onChange={(e) => set('contactEmail', e.target.value)} className={inputCls} /></Field>
        <Field label="Telefone"><input value={f.phone} onChange={(e) => set('phone', e.target.value)} className={inputCls} /></Field>
        <Field label="Endereço"><input value={f.addressLine} onChange={(e) => set('addressLine', e.target.value)} className={inputCls} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Cidade"><input value={f.city} onChange={(e) => set('city', e.target.value)} className={inputCls} /></Field>
          <Field label="UF"><input value={f.state} onChange={(e) => set('state', e.target.value)} className={inputCls} /></Field>
        </div>
        <Field label="Preço por contrato (centavos)"><input type="number" value={f.pricePerContractCents} onChange={(e) => set('pricePerContractCents', e.target.value)} className={inputCls} /></Field>
        <Field label="Dia de vencimento"><input type="number" min="1" max="28" value={f.billingDay} onChange={(e) => set('billingDay', e.target.value)} className={inputCls} /></Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.billingActive} onChange={(e) => set('billingActive', e.target.checked)} />
          Cobrança ativa (gera fatura e bloqueia por atraso)
        </label>
      </div>
    </Card>
  );
}

function InstancesCard({ lic, onChange }: { lic: any; onChange: (m: string) => void }) {
  const [newId, setNewId] = useState('');
  const [keyShown, setKeyShown] = useState<string | null>(null);

  async function createInstance() {
    try {
      const r = await adminApi.createInstance({ licenseeId: lic.id, instanceId: newId.trim() });
      setKeyShown(r.licenseKey);
      setNewId('');
      onChange('Instância criada. Copie a license key abaixo — ela não reaparece.');
    } catch (e) {
      onChange(e instanceof HubApiError ? e.message : 'Falha ao criar instância.');
    }
  }
  async function toggle(inst: any) {
    const next = inst.status === 'BLOCKED' ? 'ACTIVE' : 'BLOCKED';
    await adminApi.setInstanceStatus(inst.id, next);
    onChange(`Instância ${next === 'BLOCKED' ? 'bloqueada' : 'desbloqueada'}.`);
  }
  async function rotate(inst: any) {
    const r = await adminApi.rotateKey(inst.id);
    setKeyShown(r.licenseKey);
    onChange('Nova license key gerada — copie abaixo.');
  }

  return (
    <Card title="Instâncias (instalações do NetX)">
      {keyShown && (
        <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs">
          <p className="font-medium text-amber-800">License key (mostrada uma vez):</p>
          <code className="mt-1 block break-all rounded bg-white px-2 py-1 font-mono">{keyShown}</code>
        </div>
      )}
      {(lic.instances ?? []).length === 0 ? (
        <p className="mb-3 text-sm text-slate-500">Nenhuma instância. Cadastre o NETX_INSTANCE_ID gerado no installer.</p>
      ) : (
        <table className="mb-3 min-w-full text-sm">
          <tbody className="divide-y divide-slate-100">
            {lic.instances.map((inst: any) => (
              <tr key={inst.id}>
                <td className="py-2">
                  <div className="font-mono text-xs">{inst.id.slice(0, 8)}…</div>
                  <div className="text-xs text-slate-400">{inst.label ?? '—'}</div>
                </td>
                <td className="py-2 text-xs text-slate-500">
                  {inst.lastActiveContracts ?? '—'} contratos<br />
                  {inst.lastVersion ?? '—'} · {date(inst.lastHeartbeatAt)}
                </td>
                <td className="py-2"><Badge status={inst.status} /></td>
                <td className="py-2 text-right">
                  <button onClick={() => toggle(inst)} className="mr-2 text-xs text-blue-700 hover:underline">
                    {inst.status === 'BLOCKED' ? 'Desbloquear' : 'Bloquear'}
                  </button>
                  <button onClick={() => rotate(inst)} className="text-xs text-slate-500 hover:underline">
                    Nova key
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="flex gap-2">
        <input value={newId} onChange={(e) => setNewId(e.target.value)} placeholder="NETX_INSTANCE_ID (uuid)" className={inputCls} />
        <button onClick={createInstance} disabled={!newId.trim()} className="whitespace-nowrap rounded-md bg-slate-900 px-3 py-2 text-xs font-medium text-white disabled:opacity-50">
          Vincular
        </button>
      </div>
    </Card>
  );
}

function InvoicesCard({ licenseeId, invoices, onChange }: { licenseeId: string; invoices: any[]; onChange: (m: string) => void }) {
  async function generate() {
    const r = await adminApi.generateInvoice(licenseeId);
    onChange(r.created ? 'Fatura gerada.' : 'Fatura do período já existia.');
  }
  async function markPaid(inv: any) {
    await adminApi.markPaid(inv.id, { method: 'MANUAL' });
    onChange('Fatura marcada como paga.');
  }
  return (
    <Card title="Faturas" action={
      <button onClick={generate} className="rounded-md border border-slate-300 px-3 py-1.5 text-xs">Gerar fatura do mês</button>
    }>
      {invoices.length === 0 ? (
        <p className="text-sm text-slate-500">Nenhuma fatura.</p>
      ) : (
        <table className="min-w-full text-sm">
          <thead className="text-xs uppercase text-slate-400">
            <tr><th className="py-1 text-left">Período</th><th className="text-left">Venc.</th><th className="text-right">Valor</th><th className="text-left">Situação</th><th></th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {invoices.map((inv) => (
              <tr key={inv.id}>
                <td className="py-2">{date(inv.periodStart)} <span className="text-xs text-slate-400">({inv.activeContracts} contr.)</span></td>
                <td className="py-2">{date(inv.dueDate)}</td>
                <td className="py-2 text-right">{money(inv.amountCents, inv.currency)}</td>
                <td className="py-2"><Badge status={inv.status} /></td>
                <td className="py-2 text-right">
                  {inv.status !== 'PAID' && inv.status !== 'CANCELLED' && (
                    <button onClick={() => markPaid(inv)} className="text-xs text-blue-700 hover:underline">Marcar paga</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function HubUsersCard({ lic, onChange }: { lic: any; onChange: (m: string) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  async function create() {
    try {
      await adminApi.createHubUser({ licenseeId: lic.id, email, password });
      setEmail(''); setPassword('');
      onChange('Usuário da central criado.');
    } catch (e) {
      onChange(e instanceof HubApiError ? e.message : 'Falha ao criar usuário.');
    }
  }
  return (
    <Card title="Acesso à central do cliente">
      {(lic.users ?? []).length > 0 && (
        <ul className="mb-3 text-sm">
          {lic.users.map((u: any) => (
            <li key={u.id} className="flex justify-between border-b border-slate-100 py-1">
              <span>{u.email}</span>
              <span className="text-xs text-slate-400">{u.lastLoginAt ? `último acesso ${date(u.lastLoginAt)}` : 'nunca acessou'}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="e-mail" className={inputCls} />
        <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="senha (mín. 8)" className={inputCls} />
        <button onClick={create} disabled={!email || password.length < 8} className="rounded-md bg-slate-900 px-3 py-2 text-xs font-medium text-white disabled:opacity-50">
          Criar acesso
        </button>
      </div>
    </Card>
  );
}
