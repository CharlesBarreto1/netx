'use client';

import { useEffect } from 'react';
import { useParams } from 'next/navigation';
import useSWR from 'swr';

import {
  InvoiceDocument,
  type DocFiscal,
} from '@/components/finance/InvoiceDocument';
import { PageLoader } from '@/components/ui/Spinner';
import { ApiError } from '@/lib/api';
import type { ContractInvoice } from '@/lib/contracts-api';
import type { OneTimeCharge } from '@/lib/finance-api';
import { formatDate } from '@/lib/format';
import type {
  SifenDocument,
  SifenDocumentStatus,
  SifenDocumentType,
} from '@/lib/sifen-api';
import { useDocEmisor } from '@/lib/use-doc-emisor';
import { useFormatMoney } from '@/lib/use-money';

const TYPE_LABEL: Record<SifenDocumentType, string> = {
  FACTURA: 'FACTURA ELECTRÓNICA',
  NOTA_CREDITO: 'NOTA DE CRÉDITO ELECTRÓNICA',
  NOTA_DEBITO: 'NOTA DE DÉBITO ELECTRÓNICA',
  AUTOFACTURA: 'AUTOFACTURA ELECTRÓNICA',
  NOTA_REMISION: 'NOTA DE REMISIÓN ELECTRÓNICA',
};

const STATUS_LABEL: Record<SifenDocumentStatus, string> = {
  DRAFT: 'Borrador',
  SIGNED: 'Firmado',
  SENT: 'Enviado al SET',
  APPROVED: 'Aprobado por la SET',
  REJECTED: 'Rechazado por la SET',
  CANCELLED: 'Cancelado',
};

/**
 * /fiscal/documents/[id]/print — KuDE: representação gráfica fiscal do DTE
 * (SIFEN/PY). Renderiza CDC, timbrado, número, QR de consulta da SET e o
 * desglose de IVA, a partir do SifenDocument já emitido.
 */
export default function KudePrintPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const formatMoney = useFormatMoney();
  const { emisor, decimals } = useDocEmisor();

  const { data: doc, error } = useSWR<SifenDocument>(
    id ? `/v1/sifen/documents/${id}` : null,
  );
  const { data: invoice } = useSWR<ContractInvoice>(
    doc?.contractInvoiceId ? `/v1/contract-invoices/${doc.contractInvoiceId}` : null,
  );
  const { data: charge } = useSWR<OneTimeCharge>(
    doc?.oneTimeChargeId ? `/v1/charges/${doc.oneTimeChargeId}` : null,
  );

  useEffect(() => {
    if (doc) {
      const timer = window.setTimeout(() => window.print(), 350);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [doc]);

  if (error) {
    const msg = error instanceof ApiError ? error.friendlyMessage : 'Error al cargar';
    return <p className="p-6 text-sm text-red-600">{msg}</p>;
  }
  if (!doc) {
    return <PageLoader label="Cargando KuDE…" />;
  }

  const description =
    invoice?.reference ?? charge?.description ?? `Documento ${doc.numeroDocumento}`;

  const fiscal: DocFiscal = {
    tipoLabel: TYPE_LABEL[doc.type],
    numero: doc.numeroDocumento,
    timbrado: doc.emisorTimbrado,
    timbradoFecha: null,
    cdc: doc.cdc,
    qrUrl: doc.qrUrl,
    approved: doc.status === 'APPROVED',
    statusLabel: STATUS_LABEL[doc.status],
  };

  return (
    <InvoiceDocument
      variant="kude"
      locale="PY"
      emisor={{ ...emisor, ruc: doc.emisorRuc || emisor.ruc }}
      receptor={{ name: doc.receptorName ?? '—', taxId: doc.receptorTaxId }}
      items={[
        {
          code: null,
          description,
          quantity: 1,
          unitPrice: doc.totalAmount,
          ivaRate: 10,
        },
      ]}
      issuedAt={formatDate(doc.issuedAt)}
      currencyLabel={doc.currency === 'PYG' ? 'Guaraníes (PYG)' : doc.currency}
      total={doc.totalAmount}
      formatMoney={formatMoney}
      decimals={decimals}
      docId={doc.id}
      fiscal={fiscal}
    />
  );
}
