'use client';

import { useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/Button';
import { PageLoader } from '@/components/ui/Spinner';
import { hrApi, PAYSLIP_STATUS_LABELS, type Payslip } from '@/lib/hr-api';

export default function MeRendimentosPage() {
  const { data, isLoading } = useSWR<{ payslips: Payslip[] }>('/v1/hr/me/earnings', () => hrApi.meEarnings());
  const [open, setOpen] = useState<string | null>(null);

  if (isLoading) return <PageLoader />;
  const payslips = data?.payslips ?? [];

  async function receipt(p: Payslip) {
    const { url } = await hrApi.payslipReceipt(p.id).catch(() => ({ url: '' }));
    if (url) window.open(url, '_blank');
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Meus rendimentos</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Holerites e comprovantes de pagamento.</p>
      </header>

      {payslips.length === 0 && (
        <p className="rounded-md border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700">
          Nenhum holerite disponível ainda.
        </p>
      )}

      <div className="space-y-2">
        {payslips.map((p) => (
          <div key={p.id} className="rounded-lg border border-slate-200 bg-white p-3 text-sm dark:border-slate-700 dark:bg-slate-800">
            <div className="flex items-center justify-between">
              <div>
                <strong>{p.referenceMonth.slice(0, 7)}</strong>
                <span className="ml-2 text-xs text-slate-500">{PAYSLIP_STATUS_LABELS[p.status]}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono font-semibold">R$ {p.netAmount.toFixed(2)}</span>
                <Button size="sm" variant="ghost" onClick={() => setOpen(open === p.id ? null : p.id)}>
                  {open === p.id ? 'Fechar' : 'Detalhes'}
                </Button>
              </div>
            </div>
            {open === p.id && (
              <div className="mt-2 space-y-1 border-t border-slate-100 pt-2 dark:border-slate-700">
                {p.items.map((it, i) => (
                  <div key={i} className="flex justify-between text-xs">
                    <span className={it.kind === 'DEDUCTION' ? 'text-red-600' : ''}>
                      {it.kind === 'DEDUCTION' ? '− ' : '+ '}{it.label}
                    </span>
                    <span className="font-mono">{it.amount.toFixed(2)}</span>
                  </div>
                ))}
                {p.payment && (
                  <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                    <span>Pago em {new Date(p.payment.paidAt).toLocaleDateString('pt-BR')}</span>
                    {p.payment.receiptStorageKey && (
                      <Button size="sm" variant="ghost" onClick={() => receipt(p)}>Comprovante</Button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
