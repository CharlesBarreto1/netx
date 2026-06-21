'use client';

import { useEffect } from 'react';
import { useParams } from 'next/navigation';
import useSWR from 'swr';

import { InvoiceDocument } from '@/components/finance/InvoiceDocument';
import { PageLoader } from '@/components/ui/Spinner';
import { ApiError } from '@/lib/api';
import type { Customer } from '@/lib/crm-types';
import type { OneTimeCharge } from '@/lib/finance-api';
import { formatDate } from '@/lib/format';
import { useDocEmisor } from '@/lib/use-doc-emisor';
import { useFormatMoney } from '@/lib/use-money';

/**
 * /charges/[id]/print — documento NÃO fiscal de uma cobrança avulsa.
 * Mesma estrutura do documento de fatura; contrato é opcional.
 */
export default function ChargePrintPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const formatMoney = useFormatMoney();
  const { locale, emisor, currencyLabel, decimals } = useDocEmisor();

  const { data: charge, error } = useSWR<OneTimeCharge>(
    id ? `/v1/charges/${id}` : null,
  );
  const { data: customer } = useSWR<Customer>(
    charge ? `/v1/customers/${charge.customerId}` : null,
  );

  useEffect(() => {
    if (charge && customer) {
      const timer = window.setTimeout(() => window.print(), 350);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [charge, customer]);

  if (error) {
    const msg = error instanceof ApiError ? error.friendlyMessage : 'Falha ao carregar';
    return <p className="p-6 text-sm text-red-600">{msg}</p>;
  }
  if (!charge || !customer) {
    return <PageLoader label={locale === 'PY' ? 'Cargando…' : 'Carregando…'} />;
  }

  return (
    <InvoiceDocument
      variant="nonfiscal"
      locale={locale}
      emisor={emisor}
      receptor={{ name: customer.displayName, taxId: customer.taxId }}
      items={[
        {
          code: charge.code,
          description: charge.description,
          quantity: 1,
          unitPrice: charge.amount,
          ivaRate: locale === 'PY' ? 10 : 0,
        },
      ]}
      issuedAt={formatDate(charge.issuedAt)}
      currencyLabel={currencyLabel}
      total={charge.amount}
      formatMoney={formatMoney}
      decimals={decimals}
      docId={charge.id}
    />
  );
}
