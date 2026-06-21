'use client';

import { useEffect } from 'react';
import { useParams } from 'next/navigation';
import useSWR from 'swr';

import { InvoiceDocument } from '@/components/finance/InvoiceDocument';
import { PageLoader } from '@/components/ui/Spinner';
import { ApiError } from '@/lib/api';
import {
  type Contract,
  type ContractInvoice,
} from '@/lib/contracts-api';
import type { Customer } from '@/lib/crm-types';
import { formatDate } from '@/lib/format';
import { useDocEmisor } from '@/lib/use-doc-emisor';
import { useFormatMoney } from '@/lib/use-money';

/**
 * /invoices/[id]/print — documento NÃO fiscal de uma fatura de contrato.
 * Mesma estrutura visual do KuDE (emisor, receptor, itens, totais), porém sem
 * dados fiscais. Pra PY emitido/aprovado no SIFEN, o KuDE fiscal fica em
 * /fiscal/documents/[id]/print.
 */
export default function InvoicePrintPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const formatMoney = useFormatMoney();
  const { locale, emisor, currencyLabel, decimals } = useDocEmisor();

  const { data: invoice, error } = useSWR<ContractInvoice>(
    id ? `/v1/contract-invoices/${id}` : null,
  );
  const { data: contract } = useSWR<Contract>(
    invoice ? `/v1/contracts/${invoice.contractId}` : null,
  );
  const { data: customer } = useSWR<Customer>(
    contract ? `/v1/customers/${contract.customerId}` : null,
  );

  useEffect(() => {
    if (invoice && customer) {
      const timer = window.setTimeout(() => window.print(), 350);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [invoice, customer]);

  if (error) {
    const msg = error instanceof ApiError ? error.friendlyMessage : 'Falha ao carregar';
    return <p className="p-6 text-sm text-red-600">{msg}</p>;
  }
  if (!invoice || !customer) {
    return <PageLoader label={locale === 'PY' ? 'Cargando…' : 'Carregando…'} />;
  }

  const reference =
    invoice.reference ?? `Mensalidade — ${formatDate(invoice.dueDate)}`;

  return (
    <InvoiceDocument
      variant="nonfiscal"
      locale={locale}
      emisor={emisor}
      receptor={{ name: customer.displayName, taxId: customer.taxId }}
      items={[
        {
          code: contract?.code ?? null,
          description: reference,
          quantity: 1,
          unitPrice: invoice.amount,
          ivaRate: locale === 'PY' ? 10 : 0,
        },
      ]}
      issuedAt={formatDate(invoice.issuedAt)}
      currencyLabel={currencyLabel}
      total={invoice.amount}
      formatMoney={formatMoney}
      decimals={decimals}
      docId={invoice.id}
    />
  );
}
