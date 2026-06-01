'use client';

/**
 * /fiscal/documents — listagem de DTEs SIFEN (fatura eletrônica PY).
 *
 * Filtros: status, tipo, range de data, CDC, número fiscal.
 * Empty state quando SIFEN não configurado → CTA leva a /settings/sifen.
 */
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import useSWR from 'swr';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input, Label } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import { useFormatMoney } from '@/lib/use-money';
import { formatDateTime } from '@/lib/format';
import { hasPermission } from '@/lib/session';
import {
  sifenApi,
  type SifenConfigResponse,
  type SifenDocumentStatus,
  type SifenDocumentType,
  type ListSifenParams,
} from '@/lib/sifen-api';
import type { Paginated } from '@/lib/crm-types';
import type { SifenDocument } from '@/lib/sifen-api';

const STATUS_TONES: Record<SifenDocumentStatus, 'neutral' | 'success' | 'warning' | 'danger'> = {
  DRAFT: 'neutral',
  SIGNED: 'neutral',
  SENT: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
  CANCELLED: 'neutral',
};

const TYPE_KEYS: Record<SifenDocumentType, string> = {
  FACTURA: 'FACTURA',
  NOTA_CREDITO: 'NOTA_CREDITO',
  NOTA_DEBITO: 'NOTA_DEBITO',
  AUTOFACTURA: 'AUTOFACTURA',
  NOTA_REMISION: 'NOTA_REMISION',
};

export default function FiscalDocumentsPage() {
  const t = useTranslations('fiscal.documents');
  const tc = useTranslations('common');
  const canEmit = hasPermission('sifen.emit');
  const formatMoney = useFormatMoney();

  const [params, setParams] = useState<ListSifenParams>({
    page: 1,
    pageSize: 50,
    sortBy: 'issuedAt',
    sortDir: 'desc',
  });

  // Carrega config junto pra detectar SIFEN não configurado.
  const { data: config } = useSWR<SifenConfigResponse>(
    sifenApi.configPath(),
    () => sifenApi.getConfig(),
  );

  const { data, isLoading, mutate } = useSWR<Paginated<SifenDocument>>(
    sifenApi.listPath(params),
    () => sifenApi.list(params),
  );

  if (isLoading || !data) return <PageLoader />;

  const notConfigured =
    !config || (!config.enabled && config.source === 'unconfigured');

  function update<K extends keyof ListSifenParams>(k: K, v: ListSifenParams[K]) {
    setParams((s) => ({ ...s, [k]: v, page: 1 }));
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="mt-1 text-sm text-text-muted">
            {t('subtitle')}
          </p>
        </div>
        <div className="flex gap-2">
          {canEmit && (
            <Link href="/fiscal/documents/new">
              <Button>{t('newEmission')}</Button>
            </Link>
          )}
        </div>
      </header>

      {notConfigured && <NotConfiguredCta />}

      <Filters params={params} update={update} />

      {data.data.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface p-10 text-center text-sm text-text-muted">
          {t('empty')}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-muted">
              <tr>
                <th className="px-3 py-2 text-left font-medium">{t('col.number')}</th>
                <th className="px-3 py-2 text-left font-medium">{tc('type')}</th>
                <th className="px-3 py-2 text-left font-medium">{t('col.receiver')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('col.total')}</th>
                <th className="px-3 py-2 text-left font-medium">{tc('status')}</th>
                <th className="px-3 py-2 text-left font-medium">{t('col.issuedAt')}</th>
                <th className="px-3 py-2 text-right font-medium">{tc('actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.data.map((d) => (
                <tr key={d.id} className="hover:bg-surface-hover">
                  <td className="px-3 py-2 font-mono text-xs">{d.numeroDocumento}</td>
                  <td className="px-3 py-2">{TYPE_KEYS[d.type] ? t(`docType.${TYPE_KEYS[d.type]}`) : d.type}</td>
                  <td className="px-3 py-2">
                    <div className="text-text">{d.receptorName ?? <em className="text-text-muted">{t('noName')}</em>}</div>
                    {d.receptorTaxId && (
                      <div className="text-xs text-text-muted">{d.receptorTaxId}</div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {formatMoney(d.totalAmount)} <span className="text-text-muted">{d.currency}</span>
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={STATUS_TONES[d.status]}>{d.status}</Badge>
                    {d.rejectionCode && (
                      <div className="mt-0.5 text-xs text-rose-600 dark:text-rose-400">
                        {d.rejectionCode}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-text-muted">
                    {formatDateTime(d.issuedAt)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Link href={`/fiscal/documents/${d.id}`}>
                      <Button size="sm" variant="ghost">{tc('seeDetails')}</Button>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.pagination && data.pagination.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-text-muted">
          <span>
            {t('pageStatus', {
              page: data.pagination.page,
              totalPages: data.pagination.totalPages,
              total: data.pagination.total,
            })}
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="ghost"
              disabled={data.pagination.page <= 1}
              onClick={() => setParams((s) => ({ ...s, page: (s.page ?? 1) - 1 }))}
            >
              {tc('previous')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={data.pagination.page >= data.pagination.totalPages}
              onClick={() => setParams((s) => ({ ...s, page: (s.page ?? 1) + 1 }))}
            >
              {tc('next')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function NotConfiguredCta() {
  const t = useTranslations('fiscal.documents');
  return (
    <div className="flex flex-col items-start gap-3 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200 md:flex-row md:items-center md:justify-between">
      <div>
        <strong>{t('notConfigured.title')}</strong> {t('notConfigured.body')}
      </div>
      <Link href="/settings/sifen">
        <Button>{t('notConfigured.cta')}</Button>
      </Link>
    </div>
  );
}

function Filters({
  params,
  update,
}: {
  params: ListSifenParams;
  update: <K extends keyof ListSifenParams>(k: K, v: ListSifenParams[K]) => void;
}) {
  const t = useTranslations('fiscal.documents');
  const tc = useTranslations('common');
  return (
    <details className="rounded-lg border border-border bg-surface p-3">
      <summary className="cursor-pointer text-sm font-medium text-text">
        {tc('filter')}
      </summary>
      <div className="mt-3 grid gap-3 md:grid-cols-3 lg:grid-cols-4">
        <div>
          <Label>{tc('status')}</Label>
          <select
            value={params.status ?? ''}
            onChange={(e) => update('status', (e.target.value || undefined) as SifenDocumentStatus)}
            className="block w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
          >
            <option value="">{tc('all')}</option>
            <option value="DRAFT">DRAFT</option>
            <option value="SIGNED">SIGNED</option>
            <option value="SENT">SENT</option>
            <option value="APPROVED">APPROVED</option>
            <option value="REJECTED">REJECTED</option>
            <option value="CANCELLED">CANCELLED</option>
          </select>
        </div>
        <div>
          <Label>{tc('type')}</Label>
          <select
            value={params.type ?? ''}
            onChange={(e) => update('type', (e.target.value || undefined) as SifenDocumentType)}
            className="block w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
          >
            <option value="">{tc('all')}</option>
            <option value="FACTURA">{t('docType.FACTURA')}</option>
            <option value="NOTA_CREDITO">{t('docType.NOTA_CREDITO')}</option>
            <option value="NOTA_DEBITO">{t('docType.NOTA_DEBITO')}</option>
            <option value="AUTOFACTURA">{t('docType.AUTOFACTURA')}</option>
            <option value="NOTA_REMISION">{t('docType.NOTA_REMISION')}</option>
          </select>
        </div>
        <div>
          <Label>{t('filter.cdc')}</Label>
          <Input
            value={params.cdc ?? ''}
            onChange={(e) => update('cdc', e.target.value || undefined)}
            placeholder={t('filter.cdcPlaceholder')}
            maxLength={44}
          />
        </div>
        <div>
          <Label>{t('filter.fiscalNumber')}</Label>
          <Input
            type="number"
            value={params.numero ?? ''}
            onChange={(e) => update('numero', e.target.value ? Number(e.target.value) : undefined)}
          />
        </div>
        <div>
          <Label>{t('filter.issuedFrom')}</Label>
          <Input
            type="date"
            value={params.issuedFrom ?? ''}
            onChange={(e) => update('issuedFrom', e.target.value || undefined)}
          />
        </div>
        <div>
          <Label>{t('filter.issuedTo')}</Label>
          <Input
            type="date"
            value={params.issuedTo ?? ''}
            onChange={(e) => update('issuedTo', e.target.value || undefined)}
          />
        </div>
      </div>
    </details>
  );
}
