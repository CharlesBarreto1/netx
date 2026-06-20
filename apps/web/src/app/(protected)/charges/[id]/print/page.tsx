'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import useSWR from 'swr';

import { PageLoader } from '@/components/ui/Spinner';
import { ApiError } from '@/lib/api';
import type { Contract } from '@/lib/contracts-api';
import type { Customer } from '@/lib/crm-types';
import type { OneTimeCharge } from '@/lib/finance-api';
import { formatDate, formatDateTime, formatTaxId } from '@/lib/format';
import { useFormatMoney } from '@/lib/use-money';

/**
 * /charges/[id]/print — 2ª via imprimível de uma cobrança avulsa (OneTimeCharge).
 *
 * Espelha /invoices/[id]/print: monta um demonstrativo A4 limpo a partir dos
 * dados (cobrança + cliente + contrato opcional) e dispara `window.print()`
 * automaticamente. O contrato é opcional — cobrança pode ser avulsa, sem
 * contrato vinculado.
 */
export default function ChargePrintPage() {
  const t = useTranslations('chargePrint');
  const tc = useTranslations('common');
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const formatMoney = useFormatMoney();

  const chargeKey = id ? `/v1/charges/${id}` : null;
  const { data: charge, error: chErr } = useSWR<OneTimeCharge>(chargeKey);

  const contractKey = charge?.contractId ? `/v1/contracts/${charge.contractId}` : null;
  const { data: contract } = useSWR<Contract>(contractKey);

  const customerKey = charge ? `/v1/customers/${charge.customerId}` : null;
  const { data: customer } = useSWR<Customer>(customerKey);

  // Dispara impressão quando cobrança + cliente carregaram (contrato é opcional).
  useEffect(() => {
    if (charge && customer) {
      const timer = window.setTimeout(() => window.print(), 350);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [charge, customer]);

  if (chErr) {
    const msg =
      chErr instanceof ApiError ? chErr.friendlyMessage : tc('failureLoading');
    return <p className="p-6 text-sm text-red-600">{msg}</p>;
  }

  if (!charge || !customer) {
    return <PageLoader label={t('loading')} />;
  }

  const statusLabel: Record<typeof charge.status, string> = {
    OPEN: t('statusOpen'),
    PAID: t('statusPaid'),
    CANCELLED: t('statusCancelled'),
  };

  return (
    <div className="mx-auto max-w-[820px] bg-white p-8 text-slate-900 print:p-0">
      {/* Botões só aparecem na tela */}
      <div className="mb-6 flex items-center justify-between print:hidden">
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          {t('printPdf')}
        </button>
        <button
          type="button"
          onClick={() => window.history.back()}
          className="text-sm text-slate-600 hover:underline"
        >
          ← {tc('back')}
        </button>
      </div>

      {/* Cabeçalho */}
      <header className="border-b-2 border-slate-900 pb-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
            {charge.code && (
              <p className="text-xs text-slate-500">
                {t('code')} <strong>{charge.code}</strong>
              </p>
            )}
            <p className="text-xs text-slate-500">
              {t('issuedAt', { date: formatDateTime(charge.issuedAt) })}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-wider text-slate-500">{tc('status')}</p>
            <p className="text-base font-semibold">{statusLabel[charge.status]}</p>
            {charge.status === 'PAID' && charge.paidAt && (
              <p className="text-xs text-emerald-700">
                {t('paidAt', { date: formatDate(charge.paidAt) })}
              </p>
            )}
          </div>
        </div>
      </header>

      {/* Identificação */}
      <section className="mt-6 grid grid-cols-2 gap-6 text-sm">
        <div>
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            {t('customer')}
          </h2>
          <p className="mt-1 font-medium">{customer.displayName}</p>
          {customer.taxId && (
            <p className="text-xs text-slate-600">
              {customer.taxIdType ?? ''} {formatTaxId(customer.taxIdType, customer.taxId)}
            </p>
          )}
          {customer.primaryEmail && (
            <p className="text-xs text-slate-600">{customer.primaryEmail}</p>
          )}
          {customer.primaryPhone && (
            <p className="text-xs text-slate-600">{customer.primaryPhone}</p>
          )}
        </div>

        {contract && (
          <div>
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              {t('contract')}
            </h2>
            <p className="mt-1 font-medium">
              {contract.code ?? `#${contract.id.slice(0, 8)}`}
            </p>
            {contract.pppoeUsername && (
              <p className="text-xs text-slate-600">PPPoE: {contract.pppoeUsername}</p>
            )}
            <p className="text-xs text-slate-600">
              {t('address', { address: contract.installationAddress })}
            </p>
          </div>
        )}
      </section>

      {/* Detalhes da cobrança */}
      <section className="mt-8">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          {t('entryDetails')}
        </h2>

        <div className="overflow-x-auto">
          <table className="mt-2 w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-300 text-left">
                <th className="py-2">{tc('description')}</th>
                <th className="py-2 text-right">{t('dueDate')}</th>
                <th className="py-2 text-right">{t('amount')}</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-slate-200">
                <td className="py-3">{charge.description}</td>
                <td className="py-3 text-right">{formatDate(charge.dueDate)}</td>
                <td className="py-3 text-right tabular-nums">{formatMoney(charge.amount)}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2} className="pt-3 text-right font-semibold">
                  {t('total')}
                </td>
                <td className="pt-3 text-right text-lg font-bold tabular-nums">
                  {formatMoney(charge.amount)}
                </td>
              </tr>
              {charge.status === 'PAID' && charge.paidAmount != null && (
                <tr>
                  <td colSpan={2} className="pt-1 text-right text-xs text-emerald-700">
                    {t('paidAmount')}
                  </td>
                  <td className="pt-1 text-right text-xs tabular-nums text-emerald-700">
                    {formatMoney(charge.paidAmount)}
                  </td>
                </tr>
              )}
            </tfoot>
          </table>
        </div>

        {charge.paymentNote && (
          <p className="mt-4 text-xs text-slate-600">
            <strong>{t('paymentNote')}</strong> {charge.paymentNote}
          </p>
        )}
      </section>

      {/* Rodapé */}
      <footer className="mt-12 border-t border-slate-300 pt-3 text-[10px] text-slate-500">
        {t('footerNote')}
        <span className="ml-1 font-mono">{charge.id}</span>
      </footer>

      <style
        dangerouslySetInnerHTML={{
          __html: `
            @media print {
              @page { size: A4 portrait; margin: 18mm; }
              body { background: #fff !important; }
            }
          `,
        }}
      />
    </div>
  );
}
