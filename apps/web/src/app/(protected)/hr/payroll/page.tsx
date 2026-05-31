'use client';

import { useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input, Label } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import { ApiError, swrFetcher } from '@/lib/api';
import { cashRegistersApi, type CashRegister } from '@/lib/finance-api';
import {
  hrApi,
  PAYSLIP_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  type Employee,
  type Paginated,
  type PaymentMethod,
  type Payslip,
  type PayslipItem,
  type PayslipStatus,
} from '@/lib/hr-api';

const STATUS_BADGE: Record<PayslipStatus, string> = {
  DRAFT: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  APPROVED: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  PAID: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  CANCELLED: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
};

function thisMonth() {
  const n = new Date();
  return `${n.getUTCFullYear()}-${String(n.getUTCMonth() + 1).padStart(2, '0')}`;
}

export default function PayrollPage() {
  const [month, setMonth] = useState(thisMonth());
  const query = { month, pageSize: 200 };
  const { data, isLoading, mutate } = useSWR<Paginated<Payslip>>(
    hrApi.payslipsPath(query),
    () => hrApi.listPayslips(query),
  );
  const [creating, setCreating] = useState(false);
  const [paying, setPaying] = useState<Payslip | null>(null);
  const rows = data?.data ?? [];

  async function approve(p: Payslip) { await hrApi.approvePayslip(p.id); await mutate(); }
  async function reverse(p: Payslip) { await hrApi.reversePayment(p.id); await mutate(); }
  async function del(p: Payslip) { await hrApi.deletePayslip(p.id); await mutate(); }

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Folha de pagamento</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Holerites por competência (lançamento manual). Pagar integra no caixa.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <Label>Competência</Label>
            <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </div>
          <Button onClick={() => setCreating(true)}>Novo holerite</Button>
        </div>
      </header>

      {isLoading && <PageLoader />}
      {rows.length === 0 && !isLoading && (
        <p className="rounded-md border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700">
          Nenhum holerite nesta competência.
        </p>
      )}

      {rows.length > 0 && (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
            <thead className="bg-slate-50 dark:bg-slate-900/40">
              <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3">Colaborador</th>
                <th className="px-4 py-3 text-right">Bruto</th>
                <th className="px-4 py-3 text-right">Descontos</th>
                <th className="px-4 py-3 text-right">Líquido</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
              {rows.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/60">
                  <td className="px-4 py-3 font-medium">{p.employee?.fullName}</td>
                  <td className="px-4 py-3 text-right font-mono">{p.grossAmount.toFixed(2)}</td>
                  <td className="px-4 py-3 text-right font-mono text-red-600">{p.deductionsTotal.toFixed(2)}</td>
                  <td className="px-4 py-3 text-right font-mono font-semibold">{p.netAmount.toFixed(2)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs ${STATUS_BADGE[p.status]}`}>
                      {PAYSLIP_STATUS_LABELS[p.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {p.status === 'DRAFT' && <Button size="sm" variant="ghost" onClick={() => approve(p)}>Aprovar</Button>}
                    {p.status === 'APPROVED' && <Button size="sm" onClick={() => setPaying(p)}>Pagar</Button>}
                    {p.status === 'PAID' && <Button size="sm" variant="ghost" onClick={() => reverse(p)}>Estornar</Button>}
                    {(p.status === 'DRAFT') && <Button size="sm" variant="ghost" onClick={() => del(p)}>Excluir</Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {creating && (
        <CreatePayslipModal month={month} onClose={() => setCreating(false)} onSaved={async () => { setCreating(false); await mutate(); }} />
      )}
      {paying && (
        <PayModal payslip={paying} onClose={() => setPaying(null)} onDone={async () => { setPaying(null); await mutate(); }} />
      )}
    </div>
  );
}

function CreatePayslipModal({ month, onClose, onSaved }: { month: string; onClose: () => void; onSaved: () => void }) {
  const { data: employees } = useSWR<Paginated<Employee>>(
    hrApi.employeesPath({ status: 'ACTIVE', pageSize: 200 }),
    swrFetcher,
  );
  const [employeeId, setEmployeeId] = useState('');
  const [items, setItems] = useState<PayslipItem[]>([{ kind: 'EARNING', label: 'Salário base', amount: 0 }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const gross = items.filter((i) => i.kind === 'EARNING').reduce((s, i) => s + (i.amount || 0), 0);
  const ded = items.filter((i) => i.kind === 'DEDUCTION').reduce((s, i) => s + (i.amount || 0), 0);

  function setItem(idx: number, patch: Partial<PayslipItem>) {
    setItems(items.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  async function submit() {
    if (!employeeId) return setError('Selecione o colaborador');
    setBusy(true);
    setError(null);
    try {
      await hrApi.createPayslip({ employeeId, referenceMonth: month, items, notes: null });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.friendlyMessage : 'Erro');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Novo holerite — ${month}`}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button onClick={submit} loading={busy}>Salvar rascunho</Button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <div className="rounded-md bg-red-50 p-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</div>}
        <div>
          <Label>Colaborador</Label>
          <select
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
          >
            <option value="">Selecione…</option>
            {(employees?.data ?? []).map((e) => (
              <option key={e.id} value={e.id}>{e.fullName}</option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <Label>Proventos e descontos</Label>
          {items.map((it, idx) => (
            <div key={idx} className="flex gap-2">
              <select
                className="rounded-md border border-slate-300 bg-white px-2 text-sm dark:border-slate-600 dark:bg-slate-900"
                value={it.kind}
                onChange={(e) => setItem(idx, { kind: e.target.value as PayslipItem['kind'] })}
              >
                <option value="EARNING">Provento</option>
                <option value="DEDUCTION">Desconto</option>
              </select>
              <Input className="flex-1" placeholder="Descrição" value={it.label} onChange={(e) => setItem(idx, { label: e.target.value })} />
              <Input className="w-32" type="number" step="0.01" value={it.amount} onChange={(e) => setItem(idx, { amount: Number(e.target.value) || 0 })} />
              <Button type="button" variant="ghost" size="sm" onClick={() => setItems(items.filter((_, i) => i !== idx))}>×</Button>
            </div>
          ))}
          <Button type="button" variant="ghost" size="sm" onClick={() => setItems([...items, { kind: 'EARNING', label: '', amount: 0 }])}>
            + Adicionar linha
          </Button>
        </div>

        <div className="flex justify-end gap-4 border-t border-slate-200 pt-2 text-sm dark:border-slate-700">
          <span>Bruto: <strong className="font-mono">{gross.toFixed(2)}</strong></span>
          <span>Descontos: <strong className="font-mono text-red-600">{ded.toFixed(2)}</strong></span>
          <span>Líquido: <strong className="font-mono">{(gross - ded).toFixed(2)}</strong></span>
        </div>
      </div>
    </Modal>
  );
}

function PayModal({ payslip, onClose, onDone }: { payslip: Payslip; onClose: () => void; onDone: () => void }) {
  const { data: registers } = useSWR<CashRegister[]>(cashRegistersApi.listPath(), () => cashRegistersApi.list());
  const [method, setMethod] = useState<PaymentMethod>('BANK_TRANSFER');
  const [cashRegisterId, setCashRegisterId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pay() {
    setBusy(true);
    setError(null);
    try {
      await hrApi.payPayslip(payslip.id, {
        method,
        cashRegisterId: cashRegisterId || null,
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.friendlyMessage : 'Erro');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Pagar holerite — ${payslip.employee?.fullName}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button onClick={pay} loading={busy}>Confirmar pagamento</Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        {error && <div className="rounded-md bg-red-50 p-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</div>}
        <p>Valor líquido: <strong className="font-mono">R$ {payslip.netAmount.toFixed(2)}</strong></p>
        <div>
          <Label>Forma de pagamento</Label>
          <select className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
            {(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map((m) => (
              <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>
            ))}
          </select>
        </div>
        <div>
          <Label>Caixa (opcional — lança saída no financeiro)</Label>
          <select className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900" value={cashRegisterId} onChange={(e) => setCashRegisterId(e.target.value)}>
            <option value="">Sem lançamento no caixa</option>
            {(registers ?? []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>
      </div>
    </Modal>
  );
}
