'use client';

import { useState } from 'react';
import useSWR from 'swr';

import { Input, Label } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import { hrApi, PAYSLIP_STATUS_LABELS, type PayrollReport } from '@/lib/hr-api';

function thisMonth() {
  const n = new Date();
  return `${n.getUTCFullYear()}-${String(n.getUTCMonth() + 1).padStart(2, '0')}`;
}

const STATUS_LABEL: Record<string, string> = { ...PAYSLIP_STATUS_LABELS, MISSING: 'Sem holerite' };

export default function HrReportsPage() {
  const [month, setMonth] = useState(thisMonth());
  const { data, isLoading } = useSWR<PayrollReport>(
    hrApi.payrollReportPath(month),
    () => hrApi.payrollReport(month),
  );

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Relatório de folha</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Salários pagos e a pagar por competência.
          </p>
        </div>
        <div>
          <Label>Competência</Label>
          <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </div>
      </header>

      {isLoading && <PageLoader />}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Colaboradores" value={String(data.totals.employees)} />
            <Stat label="Total líquido" value={`R$ ${data.totals.totalNet.toFixed(2)}`} />
            <Stat label="Pago" value={`R$ ${data.totals.totalPaid.toFixed(2)}`} accent="text-green-600" />
            <Stat label="A pagar" value={`R$ ${data.totals.totalPending.toFixed(2)}`} accent="text-amber-600" />
          </div>

          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
              <thead className="bg-slate-50 dark:bg-slate-900/40">
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3">Colaborador</th>
                  <th className="px-4 py-3">Departamento</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Líquido</th>
                  <th className="px-4 py-3 text-right">Pago</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {data.rows.map((r) => (
                  <tr key={r.employeeId} className="hover:bg-slate-50 dark:hover:bg-slate-800/60">
                    <td className="px-4 py-3 font-medium">{r.employeeName}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{r.department ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{STATUS_LABEL[r.status]}</td>
                    <td className="px-4 py-3 text-right font-mono">{r.netAmount.toFixed(2)}</td>
                    <td className="px-4 py-3 text-right font-mono">{r.paidAmount.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-xl font-bold ${accent ?? ''}`}>{value}</div>
    </div>
  );
}
