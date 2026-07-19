'use client';

/**
 * /stock/report — Relatório de estoque/patrimônio.
 *
 * Filtros: depósito, produto, status, cidade (do cliente em comodato),
 * só-comodato e serial. Mostra totais (unidades + valor de compra), resumo por
 * produto e por status, e a lista detalhada. Exporta CSV.
 */
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import useSWR from 'swr';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input, Label, Select } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import { SerialHistoryModal } from '@/components/stock/SerialHistoryModal';
import { useFormatMoney } from '@/lib/use-money';
import {
  stockApi,
  type Product,
  type SerialStatus,
  type StockLocation,
  type StockReport,
  type StockReportParams,
} from '@/lib/stock-api';

const STATUS_TONE: Record<SerialStatus, 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'brand' | 'purple'> = {
  IN_STOCK: 'success',
  ALLOCATED: 'info',
  IN_USE: 'brand',
  IN_TRANSIT: 'warning',
  DEFECTIVE: 'warning',
  WRITTEN_OFF: 'neutral',
  SOLD: 'purple',
  DISCARDED: 'danger',
};
const ALL_STATUSES = Object.keys(STATUS_TONE) as SerialStatus[];

export default function StockReportPage() {
  const t = useTranslations('stock.report');
  const tAssets = useTranslations('stock.assets');
  const tc = useTranslations('common');
  const fmtMoney = useFormatMoney();

  const [locationId, setLocationId] = useState('');
  const [productId, setProductId] = useState('');
  const [status, setStatus] = useState<SerialStatus | ''>('');
  const [city, setCity] = useState('');
  const [onlyComodato, setOnlyComodato] = useState(false);
  const [serial, setSerial] = useState('');
  const [acquiredFrom, setAcquiredFrom] = useState('');
  const [acquiredTo, setAcquiredTo] = useState('');
  const [historyId, setHistoryId] = useState<string | null>(null);

  const params: StockReportParams = useMemo(
    () => ({
      ...(locationId ? { locationId } : {}),
      ...(productId ? { productId } : {}),
      ...(status ? { status } : {}),
      ...(city.trim() ? { city: city.trim() } : {}),
      ...(onlyComodato ? { onlyComodato: true } : {}),
      ...(serial.trim() ? { search: serial.trim() } : {}),
      ...(acquiredFrom ? { acquiredFrom } : {}),
      ...(acquiredTo ? { acquiredTo } : {}),
    }),
    [locationId, productId, status, city, onlyComodato, serial, acquiredFrom, acquiredTo],
  );

  const { data: locations } = useSWR<StockLocation[]>(stockApi.locationsPath(), () =>
    stockApi.listLocations(),
  );
  const { data: products } = useSWR<Product[]>(stockApi.productsPath({ type: 'PATRIMONIAL' }), () =>
    stockApi.listProducts({ type: 'PATRIMONIAL' }),
  );
  const { data: report, isLoading } = useSWR<StockReport>(
    stockApi.stockReportPath(params),
    () => stockApi.stockReport(params),
    { keepPreviousData: true },
  );

  const statusLabel = (s: SerialStatus) => tAssets(`status.${s}`);

  function handleExport() {
    if (!report) return;
    const headers = [
      t('colSerial'),
      t('colProduct'),
      'SKU',
      t('colStatus'),
      t('colLocation'),
      t('colCity'),
      t('colCustomer'),
      t('colContract'),
      t('colValue'),
    ];
    const rows = report.items.map((i) => [
      i.serial,
      i.productName,
      i.productSku,
      statusLabel(i.status),
      i.locationName ?? '',
      i.city ?? '',
      i.customerName ?? '',
      i.contractCode ?? '',
      String(i.purchaseValue).replace('.', ','),
    ]);
    const csv = [headers, ...rows]
      .map((r) => r.map(csvCell).join(';'))
      .join('\r\n');
    // BOM + separador ';' pra Excel pt/es abrir certinho.
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `relatorio-estoque-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('subtitle')}</p>
        </div>
        <Button variant="outline" onClick={handleExport} disabled={!report || report.items.length === 0}>
          {t('export')}
        </Button>
      </header>

      {/* Filtros */}
      <div className="grid gap-3 rounded-md border border-border bg-surface p-4 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <Label htmlFor="f-location">{t('filterLocation')}</Label>
          <Select id="f-location" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            <option value="">{t('allLocations')}</option>
            {(locations ?? []).map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="f-product">{t('filterProduct')}</Label>
          <Select id="f-product" value={productId} onChange={(e) => setProductId(e.target.value)}>
            <option value="">{t('allProducts')}</option>
            {(products ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="f-status">{t('filterStatus')}</Label>
          <Select
            id="f-status"
            value={status}
            onChange={(e) => setStatus(e.target.value as SerialStatus | '')}
          >
            <option value="">{tAssets('allStatuses')}</option>
            {ALL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="f-city">{t('filterCity')}</Label>
          <Input
            id="f-city"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder={t('cityPlaceholder')}
          />
        </div>
        <div>
          <Label htmlFor="f-serial">{t('filterSerial')}</Label>
          <Input id="f-serial" value={serial} onChange={(e) => setSerial(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="f-from">{t('acquiredFrom')}</Label>
          <Input
            id="f-from"
            type="date"
            value={acquiredFrom}
            onChange={(e) => setAcquiredFrom(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="f-to">{t('acquiredTo')}</Label>
          <Input
            id="f-to"
            type="date"
            value={acquiredTo}
            onChange={(e) => setAcquiredTo(e.target.value)}
          />
        </div>
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input
            type="checkbox"
            checked={onlyComodato}
            onChange={(e) => setOnlyComodato(e.target.checked)}
          />
          {t('onlyComodato')}
        </label>
      </div>

      {/* Totais */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-md border border-border bg-surface p-4">
          <div className="text-xs uppercase tracking-wider text-text-muted">{t('totalUnits')}</div>
          <div className="mt-1 text-3xl font-bold tabular-nums">
            {report?.summary.totalUnits ?? 0}
          </div>
        </div>
        <div className="rounded-md border border-border bg-surface p-4">
          <div className="text-xs uppercase tracking-wider text-text-muted">{t('totalValue')}</div>
          <div className="mt-1 text-3xl font-bold tabular-nums">
            {fmtMoney(report?.summary.totalPurchaseValue ?? 0)}
          </div>
        </div>
      </div>

      {report?.truncated && (
        <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          {t('truncated')}
        </p>
      )}

      {isLoading && !report ? (
        <PageLoader />
      ) : (
        <>
          {/* Resumo por status */}
          <section className="space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">
              {t('byStatus')}
            </h2>
            <div className="flex flex-wrap gap-2">
              {(report?.byStatus ?? []).map((s) => (
                <div
                  key={s.status}
                  className="rounded-md border border-border bg-surface px-3 py-2 text-sm"
                >
                  <Badge tone={STATUS_TONE[s.status]}>{statusLabel(s.status)}</Badge>
                  <span className="ml-2 font-medium tabular-nums">{s.units}</span>
                  <span className="ml-2 text-text-muted">{fmtMoney(s.purchaseValue)}</span>
                </div>
              ))}
            </div>
          </section>

          {/* Resumo por cidade */}
          <section className="space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">
              {t('byCity')}
            </h2>
            <div className="overflow-x-auto rounded-md border border-border bg-surface">
              <table className="min-w-full text-sm">
                <thead className="bg-surface-muted text-left text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                  <tr>
                    <th className="px-3 py-2">{t('colCity')}</th>
                    <th className="px-3 py-2 text-right">{t('colUnits')}</th>
                    <th className="px-3 py-2 text-right">{t('colValue')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {(report?.byCity ?? []).map((c) => (
                    <tr key={c.city ?? '__none__'}>
                      <td className="px-3 py-2">{c.city ?? t('noCity')}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{c.units}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(c.purchaseValue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Resumo por produto */}
          <section className="space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">
              {t('byProduct')}
            </h2>
            <div className="overflow-x-auto rounded-md border border-border bg-surface">
              <table className="min-w-full text-sm">
                <thead className="bg-surface-muted text-left text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                  <tr>
                    <th className="px-3 py-2">{t('colProduct')}</th>
                    <th className="px-3 py-2 text-right">{t('colUnits')}</th>
                    <th className="px-3 py-2 text-right">{t('colValue')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {(report?.byProduct ?? []).map((p) => (
                    <tr key={p.productId}>
                      <td className="px-3 py-2">
                        <div className="font-medium">{p.name}</div>
                        <div className="text-xs text-text-muted">{p.sku}</div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{p.units}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(p.purchaseValue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Detalhe */}
          <section className="space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">
              {t('detail')}
            </h2>
            <div className="overflow-x-auto rounded-md border border-border bg-surface">
              <table className="min-w-full text-sm">
                <thead className="bg-surface-muted text-left text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                  <tr>
                    <th className="px-3 py-2">{t('colSerial')}</th>
                    <th className="px-3 py-2">{t('colProduct')}</th>
                    <th className="px-3 py-2">{t('colStatus')}</th>
                    <th className="px-3 py-2">{t('colLocation')}</th>
                    <th className="px-3 py-2">{t('colCity')}</th>
                    <th className="px-3 py-2">{t('colContract')}</th>
                    <th className="px-3 py-2 text-right">{t('colValue')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {(report?.items ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-3 py-6 text-center text-text-muted">
                        {tc('nothingHere')}
                      </td>
                    </tr>
                  ) : (
                    (report?.items ?? []).map((i) => (
                      <tr key={i.id}>
                        <td className="px-3 py-2 font-mono">
                          <button
                            type="button"
                            onClick={() => setHistoryId(i.id)}
                            className="text-primary hover:underline"
                          >
                            {i.serial}
                          </button>
                        </td>
                        <td className="px-3 py-2">{i.productName}</td>
                        <td className="px-3 py-2">
                          <Badge tone={STATUS_TONE[i.status]}>{statusLabel(i.status)}</Badge>
                        </td>
                        <td className="px-3 py-2 text-text-muted">{i.locationName ?? '—'}</td>
                        <td className="px-3 py-2 text-text-muted">{i.city ?? '—'}</td>
                        <td className="px-3 py-2 text-text-muted">
                          {i.contractCode ?? '—'}
                          {i.customerName ? (
                            <span className="block text-xs">{i.customerName}</span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {fmtMoney(i.purchaseValue)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {historyId && (
        <SerialHistoryModal serialItemId={historyId} onClose={() => setHistoryId(null)} />
      )}
    </div>
  );
}

/** Escapa um valor pra célula CSV (separador ';'). */
function csvCell(v: string): string {
  if (/[";\r\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}
