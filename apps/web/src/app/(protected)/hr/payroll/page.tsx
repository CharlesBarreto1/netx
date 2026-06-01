'use client';

import { useTranslations } from 'next-intl';
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
  const t = useTranslations('hr.payroll');
  const tc = useTranslations('common');
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
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {t('subtitle')}
          </p>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <Label>{t('referenceMonth')}</Label>
            <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </div>
          <Button onClick={() => setCreating(true)}>{t('newPayslip')}</Button>
        </div>
      </header>

      {isLoading && <PageLoader />}
      {rows.length === 0 && !isLoading && (
        <p className="rounded-md border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700">
          {t('empty')}
        </p>
      )}

      {rows.length > 0 && (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
            <thead className="bg-slate-50 dark:bg-slate-900/40">
              <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3">{t('employee')}</th>
                <th className="px-4 py-3 text-right">{t('gross')}</th>
                <th className="px-4 py-3 text-right">{t('deductions')}</th>
                <th className="px-4 py-3 text-right">{t('net')}</th>
                <th className="px-4 py-3">{tc('status')}</th>
                <th className="px-4 py-3 text-right">{tc('actions')}</th>
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
                      {t(`status.${p.status}`)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {p.status === 'DRAFT' && <Button size="sm" variant="ghost" onClick={() => approve(p)}>{t('approve')}</Button>}
                    {p.status === 'APPROVED' && <Button size="sm" onClick={() => setPaying(p)}>{t('pay')}</Button>}
                    {p.status === 'PAID' && <Button size="sm" variant="ghost" onClick={() => reverse(p)}>{t('reverse')}</Button>}
                    {(p.status === 'DRAFT') && <Button size="sm" variant="ghost" onClick={() => del(p)}>{tc('delete')}</Button>}
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
  const t = useTranslations('hr.payroll');
  const tc = useTranslations('common');
  const { data: employees } = useSWR<Paginated<Employee>>(
    hrApi.employeesPath({ status: 'ACTIVE', pageSize: 200 }),
    swrFetcher,
  );
  const [employeeId, setEmployeeId] = useState('');
  const [items, setItems] = useState<PayslipItem[]>(() => [{ kind: 'EARNING', label: t('baseSalary'), amount: 0 }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const gross = items.filter((i) => i.kind === 'EARNING').reduce((s, i) => s + (i.amount || 0), 0);
  const ded = items.filter((i) => i.kind === 'DEDUCTION').reduce((s, i) => s + (i.amount || 0), 0);

  function setItem(idx: number, patch: Partial<PayslipItem>) {
    setItems(items.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  async function submit() {
    if (!employeeId) return setError(t('selectEmployeeError'));
    setBusy(true);
    setError(null);
    try {
      await hrApi.createPayslip({ employeeId, referenceMonth: month, items, notes: null });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.friendlyMessage : tc('error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t('createTitle', { month })}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>{tc('cancel')}</Button>
          <Button onClick={submit} loading={busy}>{t('saveDraft')}</Button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <div className="rounded-md bg-red-50 p-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</div>}
        <div>
          <Label>{t('employee')}</Label>
          <select
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
          >
            <option value="">{t('selectPlaceholder')}</option>
            {(employees?.data ?? []).map((e) => (
              <option key={e.id} value={e.id}>{e.fullName}</option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <Label>{t('earningsDeductions')}</Label>
          {items.map((it, idx) => (
            <div key={idx} className="flex gap-2">
              <select
                className="rounded-md border border-slate-300 bg-white px-2 text-sm dark:border-slate-600 dark:bg-slate-900"
                value={it.kind}
                onChange={(e) => setItem(idx, { kind: e.target.value as PayslipItem['kind'] })}
              >
                <option value="EARNING">{t('earning')}</option>
                <option value="DEDUCTION">{t('deduction')}</option>
              </select>
              <Input className="flex-1" placeholder={tc('description')} value={it.label} onChange={(e) => setItem(idx, { label: e.target.value })} />
              <Input className="w-32" type="number" step="0.01" value={it.amount} onChange={(e) => setItem(idx, { amount: Number(e.target.value) || 0 })} />
              <Button type="button" variant="ghost" size="sm" onClick={() => setItems(items.filter((_, i) => i !== idx))}>×</Button>
            </div>
          ))}
          <Button type="button" variant="ghost" size="sm" onClick={() => setItems([...items, { kind: 'EARNING', label: '', amount: 0 }])}>
            {t('addLine')}
          </Button>
        </div>

        <div className="flex justify-end gap-4 border-t border-slate-200 pt-2 text-sm dark:border-slate-700">
          <span>{t('gross')}: <strong className="font-mono">{gross.toFixed(2)}</strong></span>
          <span>{t('deductions')}: <strong className="font-mono text-red-600">{ded.toFixed(2)}</strong></span>
          <span>{t('net')}: <strong className="font-mono">{(gross - ded).toFixed(2)}</strong></span>
        </div>
      </div>
    </Modal>
  );
}

function PayModal({ payslip, onClose, onDone }: { payslip: Payslip; onClose: () => void; onDone: () => void }) {
  const t = useTranslations('hr.payroll');
  const tc = useTranslations('common');
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
      setError(err instanceof ApiError ? err.friendlyMessage : tc('error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t('payTitle', { name: payslip.employee?.fullName ?? '' })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>{tc('cancel')}</Button>
          <Button onClick={pay} loading={busy}>{t('confirmPayment')}</Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        {error && <div className="rounded-md bg-red-50 p-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</div>}
        <p>{t('netValue')}: <strong className="font-mono">R$ {payslip.netAmount.toFixed(2)}</strong></p>
        <div>
          <Label>{t('paymentMethod')}</Label>
          <select className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
            {(['CASH', 'PIX', 'CARD', 'BANK_TRANSFER', 'OTHER'] as PaymentMethod[]).map((m) => (
              <option key={m} value={m}>{t(`method.${m}`)}</option>
            ))}
          </select>
        </div>
        <div>
          <Label>{t('cashRegisterLabel')}</Label>
          <select className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900" value={cashRegisterId} onChange={(e) => setCashRegisterId(e.target.value)}>
            <option value="">{t('noCashEntry')}</option>
            {(registers ?? []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>
      </div>
    </Modal>
  );
}
