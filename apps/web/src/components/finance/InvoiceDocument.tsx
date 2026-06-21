'use client';

import { formatCdc, ivaBreakdown } from '@/lib/fiscal-doc';

import { QrCode } from './QrCode';

/**
 * Documento imprimível de cobrança, em duas variantes:
 *  - `kude`     → representação gráfica fiscal do DTE (SIFEN/PY): timbrado,
 *                 número, CDC, QR e desglose de IVA. Só pra documento aprovado.
 *  - `nonfiscal`→ mesma estrutura visual, SEM dados fiscais (PY não emitido / BR).
 *
 * Layout em cores fixas (slate) por ser documento de impressão — não segue o
 * tema da app. Termos seguem o país: PY em espanhol, BR em português.
 */
export type DocLocale = 'PY' | 'BR';

export interface DocItem {
  code?: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  ivaRate: number; // 0 | 5 | 10 (PY). BR ignora.
}

export interface DocEmisor {
  razonSocial: string;
  nombreFantasia?: string | null;
  ruc?: string | null;
  activity?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
}

export interface DocReceptor {
  name: string;
  taxId?: string | null;
  address?: string | null;
}

export interface DocFiscal {
  tipoLabel: string; // "FACTURA ELECTRÓNICA"
  numero: string; // "001-001-0000123"
  timbrado: string;
  timbradoFecha?: string | null;
  cdc: string;
  qrUrl: string | null;
  approved: boolean;
  statusLabel: string;
}

export interface InvoiceDocumentProps {
  variant: 'kude' | 'nonfiscal';
  locale: DocLocale;
  emisor: DocEmisor;
  receptor: DocReceptor;
  items: DocItem[];
  issuedAt: string; // já formatado
  condicion?: 'contado' | 'credito';
  currencyLabel: string;
  total: number;
  formatMoney: (n: number) => string;
  decimals: number;
  docId: string;
  /** Só na variante `kude`. */
  fiscal?: DocFiscal;
}

const LABELS = {
  PY: {
    nonFiscalTitle: 'Documento sin valor fiscal',
    customer: 'Cliente',
    taxId: 'RUC / CI',
    address: 'Dirección',
    issuedAt: 'Fecha de emisión',
    condicion: 'Condición de venta',
    contado: 'Contado',
    credito: 'Crédito',
    currency: 'Moneda',
    code: 'Cód.',
    description: 'Descripción',
    qty: 'Cant.',
    unit: 'P. unit.',
    exentas: 'Exentas',
    subtotal: 'Subtotal',
    totalOp: 'Total de la operación',
    totalPay: 'Total a pagar',
    ivaLiq: 'Liquidación IVA',
    iva5: 'IVA 5%',
    iva10: 'IVA 10%',
    ivaTotal: 'Total IVA',
    cdcLabel: 'CDC',
    legendValidity:
      'Consulte la validez de esta Factura Electrónica con el número de CDC en ekuatia.set.gov.py/consultas/',
    legendKude:
      'ESTE DOCUMENTO ES UNA REPRESENTACIÓN GRÁFICA DE UN DOCUMENTO ELECTRÓNICO (KuDE)',
    nonFiscalNote:
      'Este documento no tiene valor fiscal. Para la factura electrónica oficial, emití el documento en el SIFEN.',
    footerId: 'ID del documento:',
  },
  BR: {
    nonFiscalTitle: 'Documento sem valor fiscal',
    customer: 'Cliente',
    taxId: 'CPF / CNPJ',
    address: 'Endereço',
    issuedAt: 'Data de emissão',
    condicion: 'Condição',
    contado: 'À vista',
    credito: 'A prazo',
    currency: 'Moeda',
    code: 'Cód.',
    description: 'Descrição',
    qty: 'Qtd.',
    unit: 'Valor unit.',
    exentas: 'Valor',
    subtotal: 'Subtotal',
    totalOp: 'Total',
    totalPay: 'Total a pagar',
    ivaLiq: '',
    iva5: '',
    iva10: '',
    ivaTotal: '',
    cdcLabel: '',
    legendValidity: '',
    legendKude: '',
    nonFiscalNote:
      'Documento de uso interno — não substitui a nota fiscal ou o boleto bancário oficial.',
    footerId: 'ID do documento:',
  },
} as const;

export function InvoiceDocument(props: InvoiceDocumentProps) {
  const {
    variant,
    locale,
    emisor,
    receptor,
    items,
    issuedAt,
    condicion = 'contado',
    currencyLabel,
    total,
    formatMoney,
    decimals,
    docId,
    fiscal,
  } = props;

  const t = LABELS[locale];
  const isPy = locale === 'PY';
  const numLocale = isPy ? 'es-PY' : 'pt-BR';
  const n = (v: number) =>
    v.toLocaleString(numLocale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });

  const lines = items.map((it) => ({
    ...it,
    lineTotal: it.quantity * it.unitPrice,
  }));
  const sum5 = lines
    .filter((l) => l.ivaRate === 5)
    .reduce((s, l) => s + l.lineTotal, 0);
  const sum10 = lines
    .filter((l) => l.ivaRate === 10)
    .reduce((s, l) => s + l.lineTotal, 0);
  const iva5 = ivaBreakdown(sum5, 5).iva;
  const iva10 = ivaBreakdown(sum10, 10).iva;

  return (
    <div className="mx-auto max-w-[820px] bg-white p-8 text-slate-900 print:p-0">
      {/* Toolbar — só na tela */}
      <div className="mb-6 flex items-center justify-between print:hidden">
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          {isPy ? 'Imprimir / guardar PDF' : 'Imprimir / salvar PDF'}
        </button>
        <button
          type="button"
          onClick={() => window.history.back()}
          className="text-sm text-slate-600 hover:underline"
        >
          ← {isPy ? 'Volver' : 'Voltar'}
        </button>
      </div>

      {/* Cabeçalho: emisor + caixa fiscal/título */}
      <header className="flex items-start justify-between gap-4 border-b-2 border-slate-900 pb-4">
        <div className="text-xs text-slate-600">
          <p className="text-lg font-bold text-slate-900">{emisor.razonSocial}</p>
          {emisor.nombreFantasia && <p>{emisor.nombreFantasia}</p>}
          {emisor.activity && <p>{emisor.activity}</p>}
          {emisor.address && <p>{emisor.address}</p>}
          {(emisor.phone || emisor.email) && (
            <p>{[emisor.phone, emisor.email].filter(Boolean).join(' · ')}</p>
          )}
        </div>
        <div className="w-[240px] shrink-0 rounded-md border border-slate-400 p-2 text-center text-xs">
          {emisor.ruc && (
            <p className="text-slate-600">
              RUC <span className="font-semibold text-slate-900">{emisor.ruc}</span>
            </p>
          )}
          {variant === 'kude' && fiscal ? (
            <>
              <p className="text-slate-600">
                Timbrado N°{' '}
                <span className="font-semibold text-slate-900">{fiscal.timbrado}</span>
              </p>
              {fiscal.timbradoFecha && (
                <p className="text-[11px] text-slate-500">
                  Inicio vigencia {fiscal.timbradoFecha}
                </p>
              )}
              <p className="mt-2 border-t border-slate-200 pt-2 font-semibold text-slate-900">
                {fiscal.tipoLabel}
              </p>
              <p className="text-base font-semibold text-slate-900">{fiscal.numero}</p>
            </>
          ) : (
            <p className="mt-2 border-t border-slate-200 pt-2 font-semibold text-slate-900">
              {t.nonFiscalTitle}
            </p>
          )}
        </div>
      </header>

      {/* Receptor */}
      <section className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 border-b border-slate-200 pb-3 text-sm">
        <p>
          <span className="text-slate-500">{t.issuedAt}:</span> {issuedAt}
        </p>
        <p>
          <span className="text-slate-500">{t.condicion}:</span>{' '}
          {condicion === 'credito' ? t.credito : t.contado}
        </p>
        <p>
          <span className="text-slate-500">{t.customer}:</span> {receptor.name}
        </p>
        <p>
          <span className="text-slate-500">{t.taxId}:</span> {receptor.taxId ?? '—'}
        </p>
        {receptor.address && (
          <p>
            <span className="text-slate-500">{t.address}:</span> {receptor.address}
          </p>
        )}
        <p>
          <span className="text-slate-500">{t.currency}:</span> {currencyLabel}
        </p>
      </section>

      {/* Detalhe */}
      <table className="mt-4 w-full border-collapse text-xs">
        <thead>
          <tr className="bg-slate-50 text-left text-slate-600">
            <th className="border border-slate-200 px-2 py-1">{t.code}</th>
            <th className="border border-slate-200 px-2 py-1">{t.description}</th>
            <th className="border border-slate-200 px-2 py-1 text-right">{t.qty}</th>
            <th className="border border-slate-200 px-2 py-1 text-right">{t.unit}</th>
            <th className="border border-slate-200 px-2 py-1 text-right">{t.exentas}</th>
            {isPy && (
              <>
                <th className="border border-slate-200 px-2 py-1 text-right">5%</th>
                <th className="border border-slate-200 px-2 py-1 text-right">10%</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i} className="text-slate-900">
              <td className="border border-slate-200 px-2 py-1">{l.code ?? '—'}</td>
              <td className="border border-slate-200 px-2 py-1">{l.description}</td>
              <td className="border border-slate-200 px-2 py-1 text-right">{l.quantity}</td>
              <td className="border border-slate-200 px-2 py-1 text-right tabular-nums">
                {n(l.unitPrice)}
              </td>
              <td className="border border-slate-200 px-2 py-1 text-right tabular-nums">
                {isPy ? (l.ivaRate ? '' : n(l.lineTotal)) : n(l.lineTotal)}
              </td>
              {isPy && (
                <>
                  <td className="border border-slate-200 px-2 py-1 text-right tabular-nums">
                    {l.ivaRate === 5 ? n(l.lineTotal) : ''}
                  </td>
                  <td className="border border-slate-200 px-2 py-1 text-right tabular-nums">
                    {l.ivaRate === 10 ? n(l.lineTotal) : ''}
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      {/* Totais */}
      <div className="mt-3 flex justify-end gap-6 text-sm">
        <div className="text-right text-slate-500">
          <p>{t.subtotal}</p>
          <p>{t.totalOp}</p>
          <p className="font-semibold text-slate-900">{t.totalPay}</p>
        </div>
        <div className="min-w-[110px] text-right text-slate-900 tabular-nums">
          <p>{n(total)}</p>
          <p>{n(total)}</p>
          <p className="text-base font-semibold">{formatMoney(total)}</p>
        </div>
      </div>

      {/* Liquidação IVA (PY) */}
      {isPy && (sum5 > 0 || sum10 > 0) && (
        <div className="mt-2 flex justify-between rounded-md border border-slate-200 px-3 py-2 text-xs text-slate-600">
          <span>{t.ivaLiq}</span>
          <span>
            {t.iva5}: <span className="text-slate-900 tabular-nums">{n(iva5)}</span>
          </span>
          <span>
            {t.iva10}: <span className="text-slate-900 tabular-nums">{n(iva10)}</span>
          </span>
          <span>
            {t.ivaTotal}:{' '}
            <span className="text-slate-900 tabular-nums">{n(iva5 + iva10)}</span>
          </span>
        </div>
      )}

      {/* Rodapé */}
      {variant === 'kude' && fiscal ? (
        <div className="mt-6 border-t border-slate-200 pt-4">
          <div className="flex items-center gap-4">
            {fiscal.qrUrl && <QrCode value={fiscal.qrUrl} size={104} />}
            <div className="text-[11px] leading-relaxed text-slate-600">
              <p className="font-semibold text-slate-900">{t.cdcLabel}</p>
              <p className="break-all font-mono text-[11px] text-slate-900">
                {formatCdc(fiscal.cdc)}
              </p>
              <p className="mt-1">{t.legendValidity}</p>
              <p className="mt-1 text-slate-500">{t.legendKude}</p>
            </div>
          </div>
          <div
            className={`mt-3 inline-block rounded-md px-2.5 py-0.5 text-[11px] ${
              fiscal.approved
                ? 'bg-emerald-50 text-emerald-700'
                : 'bg-amber-50 text-amber-700'
            }`}
          >
            {fiscal.statusLabel}
          </div>
        </div>
      ) : (
        <div className="mt-6 border-t border-slate-200 pt-3 text-[11px] text-slate-500">
          <p>{t.nonFiscalNote}</p>
          <p className="mt-1">
            {t.footerId} <span className="font-mono">{docId}</span>
          </p>
        </div>
      )}

      <style
        dangerouslySetInnerHTML={{
          __html: `
            @media print {
              @page { size: A4 portrait; margin: 16mm; }
              body { background: #fff !important; }
            }
          `,
        }}
      />
    </div>
  );
}
