'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import useSWR from 'swr';

import { Button } from '@/components/ui/Button';
import { Input, Label, Select } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import { Tabs, type TabItem } from '@/components/ui/Tabs';
import {
  reportsApi,
  type CashRegistersReport,
  type CustomersReport,
  type FinanceReport,
  type ForecastReport,
} from '@/lib/reports-api';
import { useFormatMoney } from '@/lib/use-money';

type TabKey = 'customers' | 'cash' | 'finance' | 'forecast';

export default function ReportsPage() {
  const t = useTranslations('reports');
  const [tab, setTab] = useState<TabKey>('customers');

  const items: TabItem<TabKey>[] = [
    { value: 'customers', label: t('tabs.customers') },
    { value: 'cash', label: t('tabs.cash') },
    { value: 'finance', label: t('tabs.finance') },
    { value: 'forecast', label: t('tabs.forecast') },
  ];

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-text-muted">{t('subtitle')}</p>
      </header>

      <Tabs value={tab} onChange={setTab} items={items} />

      <div className="pt-2">
        {tab === 'customers' && <CustomersTab />}
        {tab === 'cash' && <CashTab />}
        {tab === 'finance' && <FinanceTab />}
        {tab === 'forecast' && <ForecastTab />}
      </div>
    </div>
  );
}

// =============================================================================
// CUSTOMERS
// =============================================================================
function CustomersTab() {
  const t = useTranslations('reports.customers');
  const tCommon = useTranslations('common');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const { data } = useSWR<CustomersReport>(
    reportsApi.customersPath({ from: from || undefined, to: to || undefined }),
  );
  if (!data) return <PageLoader />;
  return (
    <div className="space-y-4">
      <DateFilters from={from} to={to} onFromChange={setFrom} onToChange={setTo} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card label={t('total')} value={String(data.totals.total)} />
        <Card label={t('individuals')} value={String(data.totals.individuals)} />
        <Card label={t('companies')} value={String(data.totals.companies)} />
        <Card
          label={t('newInPeriod')}
          value={data.newInPeriod !== null ? String(data.newInPeriod) : '—'}
        />
      </div>
      <Section title={t('byStatus')}>
        <SimpleTable
          cols={[tCommon('status'), tCommon('actions')]}
          rows={data.byStatus.map((r) => [r.status, String(r.count)])}
        />
      </Section>
      <Section title={t('byCity')}>
        <SimpleTable
          cols={[t('city'), t('count')]}
          rows={data.byCity.map((r) => [r.city, String(r.count)])}
          emptyText={tCommon('nothingHere')}
        />
      </Section>
    </div>
  );
}

// =============================================================================
// CASH REGISTERS
// =============================================================================
function CashTab() {
  const t = useTranslations('reports.cash');
  const tCommon = useTranslations('common');
  const formatMoney = useFormatMoney();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const { data } = useSWR<CashRegistersReport>(
    reportsApi.cashRegistersPath({ from: from || undefined, to: to || undefined }),
  );
  if (!data) return <PageLoader />;
  return (
    <div className="space-y-4">
      <DateFilters from={from} to={to} onFromChange={setFrom} onToChange={setTo} />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <Card label={t('income')} value={formatMoney(data.totalsAcrossRegisters.income)} tone="success" />
        <Card label={t('outcome')} value={formatMoney(data.totalsAcrossRegisters.outcome)} tone="danger" />
        <Card label={t('net')} value={formatMoney(data.totalsAcrossRegisters.netInPeriod)} tone="brand" />
      </div>
      <SimpleTable
        cols={[
          t('register'),
          t('income'),
          t('outcome'),
          t('net'),
          t('balance'),
        ]}
        rows={data.registers.map((r) => [
          r.name,
          formatMoney(r.income + r.transferIn),
          formatMoney(r.outcome + r.transferOut),
          formatMoney(r.netInPeriod),
          formatMoney(r.currentBalance),
        ])}
        emptyText={tCommon('nothingHere')}
      />
    </div>
  );
}

// =============================================================================
// FINANCE
// =============================================================================
function FinanceTab() {
  const t = useTranslations('reports.finance');
  const formatMoney = useFormatMoney();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const { data } = useSWR<FinanceReport>(
    reportsApi.financePath({ from: from || undefined, to: to || undefined }),
  );
  if (!data) return <PageLoader />;
  return (
    <div className="space-y-4">
      <DateFilters from={from} to={to} onFromChange={setFrom} onToChange={setTo} />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <Card
          label={t('open')}
          value={`${data.open.count} · ${formatMoney(data.open.amount)}`}
          tone="info"
        />
        <Card
          label={t('overdue')}
          value={`${data.overdue.count} · ${formatMoney(data.overdue.amount)}`}
          tone="danger"
        />
        <Card
          label={t('received')}
          value={`${data.receivedInPeriod.count} · ${formatMoney(data.receivedInPeriod.amount)}`}
          tone="success"
        />
      </div>
      <Section title={t('byMethod')}>
        <SimpleTable
          cols={[t('method'), t('count'), t('amount')]}
          rows={data.byMethod.map((r) => [r.method, String(r.count), formatMoney(r.amount)])}
        />
      </Section>
      <Section title={t('byCash')}>
        <SimpleTable
          cols={[t('register'), t('count'), t('amount')]}
          rows={data.byCashRegister.map((r) => [
            r.cashRegisterName,
            String(r.count),
            formatMoney(r.amount),
          ])}
        />
      </Section>
    </div>
  );
}

// =============================================================================
// FORECAST
// =============================================================================
function ForecastTab() {
  const t = useTranslations('reports.forecast');
  const formatMoney = useFormatMoney();
  const [months, setMonths] = useState('6');
  const { data } = useSWR<ForecastReport>(
    reportsApi.forecastPath({ months: Number(months) || 6 }),
  );
  if (!data) return <PageLoader />;
  return (
    <div className="space-y-4">
      <div className="flex items-end gap-2">
        <div>
          <Label htmlFor="rep-months">{t('months')}</Label>
          <Select
            id="rep-months"
            value={months}
            onChange={(e) => setMonths(e.target.value)}
            className="w-28"
          >
            {[3, 6, 12, 18, 24].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <Card label={t('baseline')} value={formatMoney(data.monthlyBaseline)} />
        <Card label={t('total')} value={formatMoney(data.totalForecast)} tone="brand" />
        <Card
          label={t('months')}
          value={`${data.months}`}
        />
      </div>
      <SimpleTable
        cols={[t('month'), t('activeContracts'), t('expected')]}
        rows={data.byMonth.map((m) => [
          m.yearMonth,
          String(m.activeContracts),
          formatMoney(m.expectedRevenue),
        ])}
      />
      <p className="text-xs text-text-muted">{t('disclaimer')}</p>
    </div>
  );
}

// =============================================================================
// HELPERS
// =============================================================================
function DateFilters({
  from,
  to,
  onFromChange,
  onToChange,
}: {
  from: string;
  to: string;
  onFromChange: (v: string) => void;
  onToChange: (v: string) => void;
}) {
  const t = useTranslations('reports');
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div>
        <Label>{t('from')}</Label>
        <Input
          type="date"
          value={from}
          onChange={(e) => onFromChange(e.target.value)}
        />
      </div>
      <div>
        <Label>{t('to')}</Label>
        <Input type="date" value={to} onChange={(e) => onToChange(e.target.value)} />
      </div>
      {(from || to) && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            onFromChange('');
            onToChange('');
          }}
        >
          {t('clearDates')}
        </Button>
      )}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-md border border-border bg-surface p-3">
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Card({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'success' | 'danger' | 'brand' | 'info';
}) {
  const cls =
    tone === 'success'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200'
      : tone === 'danger'
        ? 'border-red-200 bg-red-50 text-red-900 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200'
        : tone === 'brand'
          ? 'border-brand-200 bg-brand-50 text-brand-900 dark:border-brand-900/60 dark:bg-brand-950/30 dark:text-brand-200'
          : tone === 'info'
            ? 'border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-200'
            : 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-200';
  return (
    <div className={`rounded-lg border p-3 ${cls}`}>
      <div className="text-[11px] font-semibold uppercase tracking-wider opacity-80">
        {label}
      </div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function SimpleTable({
  cols,
  rows,
  emptyText,
}: {
  cols: string[];
  rows: string[][];
  emptyText?: string;
}) {
  return (
    <div className="overflow-x-auto rounded-md border border-border bg-surface">
      <table className="min-w-full text-sm">
        <thead className="bg-surface-muted text-left text-[11px] font-semibold uppercase tracking-wider text-text-muted">
          <tr>
            {cols.map((c) => (
              <th key={c} className="px-3 py-2">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={cols.length} className="px-3 py-6 text-center text-text-muted">
                {emptyText ?? '—'}
              </td>
            </tr>
          ) : (
            rows.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (
                  <td key={j} className="px-3 py-2 text-text-muted">
                    {c}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
