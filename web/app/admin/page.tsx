'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { adminApi, adminToken, HubApiError } from '@/lib/api';
import { AdminNav } from '@/components/AdminNav';

export default function AdminHome() {
  const router = useRouter();
  const [licensees, setLicensees] = useState<any[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  async function load() {
    try {
      setLicensees(await adminApi.listLicensees());
    } catch (e) {
      if (e instanceof HubApiError && e.status === 401) {
        router.replace('/admin/login');
        return;
      }
      setErr('Falha ao carregar.');
    }
  }

  useEffect(() => {
    if (!adminToken.get()) {
      router.replace('/admin/login');
      return;
    }
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <AdminNav />
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold">Clientes (licenciados)</h1>
        <button
          onClick={() => setCreating(true)}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white"
        >
          Novo cliente
        </button>
      </header>

      {err && <p className="text-sm text-red-600">{err}</p>}
      {!licensees ? (
        <p className="text-sm text-slate-500">Carregando…</p>
      ) : licensees.length === 0 ? (
        <p className="text-sm text-slate-500">Nenhum cliente cadastrado.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2 text-left">Nome</th>
                <th className="px-4 py-2 text-left">Plano</th>
                <th className="px-4 py-2 text-right">Instâncias</th>
                <th className="px-4 py-2 text-right">Preço/contrato</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {licensees.map((l) => (
                <tr key={l.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2">
                    <Link href={`/admin/licensees/${l.id}`} className="font-medium text-blue-700 hover:underline">
                      {l.name}
                    </Link>
                    {l.taxId && <span className="block text-xs text-slate-400">{l.taxId}</span>}
                  </td>
                  <td className="px-4 py-2">{l.plan}</td>
                  <td className="px-4 py-2 text-right">{l._count?.instances ?? 0}</td>
                  <td className="px-4 py-2 text-right">
                    {(l.pricePerContractCents / 100).toLocaleString('pt-BR', {
                      style: 'currency',
                      currency: l.currency ?? 'BRL',
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && <CreateLicenseeDialog onClose={() => setCreating(false)} onSaved={load} />}
    </main>
  );
}

function CreateLicenseeDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [taxId, setTaxId] = useState('');
  const [price, setPrice] = useState('0');
  const [billingDay, setBillingDay] = useState('10');
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setSaving(true);
    try {
      await adminApi.createLicensee({
        name,
        taxId: taxId || undefined,
        pricePerContractCents: Math.round(parseFloat(price || '0') * 100),
        billingDay: parseInt(billingDay, 10) || 10,
      });
      onSaved();
      onClose();
    } catch {
      setErr('Falha ao salvar.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={save}
        className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl"
      >
        <h2 className="mb-3 text-lg font-semibold">Novo cliente</h2>
        <div className="flex flex-col gap-3">
          <Field label="Nome / Razão social">
            <input value={name} onChange={(e) => setName(e.target.value)} required className={inputCls} />
          </Field>
          <Field label="CNPJ / RUC (opcional)">
            <input value={taxId} onChange={(e) => setTaxId(e.target.value)} className={inputCls} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Preço por contrato (R$)">
              <input type="number" step="0.01" min="0" value={price} onChange={(e) => setPrice(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Dia de vencimento">
              <input type="number" min="1" max="28" value={billingDay} onChange={(e) => setBillingDay(e.target.value)} className={inputCls} />
            </Field>
          </div>
          {err && <p className="text-sm text-red-600">{err}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm">
              Cancelar
            </button>
            <button disabled={saving || !name} className="rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50">
              {saving ? 'Salvando…' : 'Criar'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

const inputCls = 'w-full rounded-md border border-slate-300 px-3 py-2 text-sm';
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      {children}
    </label>
  );
}
