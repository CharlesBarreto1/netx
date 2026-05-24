'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

import { api } from '@/lib/api';
import {
  type Contract,
  type ContractInvoice,
} from '@/lib/contracts-api';
import type { Customer } from '@/lib/crm-types';
import {
  type CashRegister,
  type OneTimeCharge,
} from '@/lib/finance-api';

/**
 * /receipts/[type]/[id] — recibo de pagamento formatado pra impressora
 * matricial (80 colunas, monospace, plain text).
 *
 * type = invoice | charge
 *
 * Layout: 80 cols de largura, fonte monospace `Courier New`. Sem cores,
 * sem bordas CSS — só texto. CSS @media print remove margens do navegador.
 *
 * Auto-dispara `window.print()` quando os dados chegam.
 *
 * Observações:
 *   - Rota fora de (protected) pra ter layout limpo, então busca via
 *     api.get direto (não SWR) — não há fetcher global aqui.
 *   - Tenant + user vêm de localStorage (sessão já existe na aba pai).
 */
type Loaded =
  | { kind: 'invoice'; invoice: ContractInvoice; contract: Contract; customer: Customer; register: CashRegister | null }
  | { kind: 'charge'; charge: OneTimeCharge; customer: Customer; register: CashRegister | null };

export default function ReceiptPage() {
  const params = useParams<{ type: string; id: string }>();
  const type = params?.type;
  const id = params?.id;
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);

  const tenantRaw =
    typeof window !== 'undefined' ? localStorage.getItem('netx.tenant') : null;
  const userRaw =
    typeof window !== 'undefined' ? localStorage.getItem('netx.user') : null;
  const tenant = tenantRaw ? JSON.parse(tenantRaw) : null;
  const user = userRaw ? JSON.parse(userRaw) : null;

  useEffect(() => {
    if (!type || !id) return;
    let cancelled = false;
    (async () => {
      try {
        if (type === 'invoice') {
          const invoice = await api.get<ContractInvoice>(`/v1/contract-invoices/${id}`);
          const contract = await api.get<Contract>(`/v1/contracts/${invoice.contractId}`);
          const customer = await api.get<Customer>(`/v1/customers/${contract.customerId}`);
          let register: CashRegister | null = null;
          if (invoice.cashRegisterId) {
            const list = await api.get<CashRegister[]>('/v1/cash-registers');
            register = list.find((r) => r.id === invoice.cashRegisterId) ?? null;
          }
          if (!cancelled) {
            setData({ kind: 'invoice', invoice, contract, customer, register });
          }
        } else if (type === 'charge') {
          const charge = await api.get<OneTimeCharge>(`/v1/charges/${id}`);
          const customer = await api.get<Customer>(`/v1/customers/${charge.customerId}`);
          let register: CashRegister | null = null;
          if (charge.cashRegisterId) {
            const list = await api.get<CashRegister[]>('/v1/cash-registers');
            register = list.find((r) => r.id === charge.cashRegisterId) ?? null;
          }
          if (!cancelled) {
            setData({ kind: 'charge', charge, customer, register });
          }
        } else {
          if (!cancelled) setError(`Tipo desconocido: ${type}`);
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message ?? 'Error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [type, id]);

  // Dispara print só uma vez quando os dados chegam.
  useEffect(() => {
    if (!data) return;
    const t = setTimeout(() => window.print(), 250);
    return () => clearTimeout(t);
  }, [data]);

  if (error) {
    return <main className="p-8 font-mono text-sm">Error: {error}</main>;
  }
  if (!data) {
    return <main className="p-8 font-mono text-sm">Cargando recibo…</main>;
  }

  const isPaid =
    data.kind === 'invoice'
      ? data.invoice.status === 'PAID'
      : data.charge.status === 'PAID';
  if (!isPaid) {
    return (
      <main className="p-8 font-mono text-sm">
        Esta {data.kind === 'invoice' ? 'factura' : 'cobranza'} aún no fue
        pagada — no se puede emitir recibo.
      </main>
    );
  }

  const item = data.kind === 'invoice' ? data.invoice : data.charge;
  const amount = item.amount;
  const paidAmount = item.paidAmount ?? amount;
  const discount = item.discountAmount ?? 0;
  const paidAt = item.paidAt;
  const paidVia = item.paidVia;
  const description =
    data.kind === 'invoice'
      ? data.invoice.reference ?? 'Mensualidad'
      : data.charge.description ?? 'Cargo puntual';
  const code =
    data.kind === 'invoice'
      ? data.contract.code ?? `INV-${data.invoice.id.slice(0, 8)}`
      : data.charge.code ?? `CB-${data.charge.id.slice(0, 8)}`;
  const recNo = item.id.slice(0, 8).toUpperCase();
  const customer = data.customer;
  const contract = data.kind === 'invoice' ? data.contract : null;
  const register = data.register;

  const currencySymbol =
    tenant?.currency === 'PYG' ? '₲' : tenant?.currency ?? '$';
  const fmt = (v: number): string => {
    if (tenant?.currency === 'PYG') {
      return new Intl.NumberFormat('es-PY', { maximumFractionDigits: 0 }).format(v);
    }
    return new Intl.NumberFormat('es-PY', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(v);
  };
  const dt = paidAt ? new Date(paidAt) : new Date();
  const dtStr = dt.toLocaleString('es-PY', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const PAY_METHOD_LABEL: Record<string, string> = {
    CASH: 'Efectivo',
    PIX: 'PIX',
    CARD: 'Tarjeta',
    BANK_TRANSFER: 'Transferencia',
    OTHER: 'Otro',
  };

  const W = 80;
  const sep = '='.repeat(W);
  const dash = '-'.repeat(W);
  const center = (s: string) =>
    ' '.repeat(Math.max(0, Math.floor((W - s.length) / 2))) + s;
  const pad = (l: string, r: string) =>
    l + ' '.repeat(Math.max(1, W - l.length - r.length)) + r;

  const lines: (string | null)[] = [
    sep,
    center((tenant?.name ?? 'NetX').toUpperCase()),
    center(`RUC: ${tenant?.taxId ?? '—'}`),
    sep,
    '',
    center('R E C I B O   D E   P A G O'),
    center(`Nº: ${recNo}`),
    center(`Fecha: ${dtStr}`),
    '',
    pad(
      `CLIENTE: ${customer.displayName.slice(0, 50)}`,
      customer.code ? `Cód: ${customer.code}` : '',
    ),
    customer.taxId ? `DOCUMENTO: ${customer.taxIdType ?? ''} ${customer.taxId}` : null,
    contract?.installationAddress
      ? `DIRECCIÓN: ${contract.installationAddress.slice(0, 70)}`
      : null,
    '',
    dash,
    pad('DESCRIPCIÓN', `${currencySymbol}  VALOR`),
    dash,
    pad(`${code}  ${description.slice(0, 40)}`, fmt(amount)),
    discount > 0 ? pad('  (descuento aplicado)', `-${fmt(discount)}`) : null,
    dash,
    pad('TOTAL PAGADO:', `${currencySymbol} ${fmt(paidAmount)}`),
    '',
    `FORMA DE PAGO..: ${paidVia ? PAY_METHOD_LABEL[paidVia] ?? paidVia : '—'}`,
    `CAJA...........: ${register?.name ?? '—'}`,
    `ATENDIDO POR...: ${user ? `${user.firstName} ${user.lastName}`.trim() : '—'}`,
    '',
    sep,
    center('Conserve este recibo como comprobante de pago.'),
    sep,
    '',
    '',
    '',
  ];

  return (
    <>
      {/* `<style jsx global>` (styled-jsx) não tipa no Next 16.
          dangerouslySetInnerHTML preserva o mesmo comportamento global sem
          dep extra. CSS é estático — sem risco de XSS. */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @page { margin: 5mm; size: 220mm auto; }
            body { background: white; }
            @media screen {
              .receipt {
                margin: 1rem auto; padding: 1rem;
                border: 1px dashed #ccc; background: #fff;
                max-width: 80ch;
              }
              .actions { text-align: center; margin: 1rem; }
            }
            @media print {
              .actions { display: none; }
              .receipt { margin: 0; padding: 0; }
            }
            .receipt {
              font-family: 'Courier New', Courier, monospace;
              font-size: 12px; line-height: 1.3;
              white-space: pre; color: #000;
            }
          `,
        }}
      />

      <div className="actions">
        <button
          onClick={() => window.print()}
          className="rounded border border-border px-4 py-2 text-sm"
        >
          Imprimir
        </button>{' '}
        <button
          onClick={() => window.close()}
          className="rounded border border-border px-4 py-2 text-sm"
        >
          Cerrar
        </button>
      </div>

      <pre className="receipt">
        {lines.filter((l): l is string => l !== null).join('\n')}
      </pre>
    </>
  );
}
