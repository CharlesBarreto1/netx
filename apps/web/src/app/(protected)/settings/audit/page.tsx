'use client';

import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import useSWR from 'swr';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { FieldHelp, Input, Label, Select } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import {
  auditApi,
  type AuditLevel,
  type AuditLogEntry,
  type AuditLogsResponse,
} from '@/lib/audit-api';
import { formatDateTime } from '@/lib/format';

const LEVEL_TONE: Record<AuditLevel, 'info' | 'warning' | 'danger' | 'success'> = {
  INFO: 'info',
  WARNING: 'warning',
  ERROR: 'danger',
  SECURITY: 'success',
};

const PAGE_SIZE = 50;

/**
 * /settings/audit — listagem completa da trilha de auditoria.
 *
 * Filtros (todos opcionais, combináveis):
 *   - busca textual: ação ou ID
 *   - resource: contracts, customers, users, ...
 *   - level: INFO/WARNING/ERROR/SECURITY
 *   - dateFrom / dateTo (datetime-local — convertido pra ISO no submit)
 *
 * Cada linha expande mostrando before/after/metadata em JSON.
 */
export default function AuditPage() {
  const t = useTranslations('audit');
  const tLevel = useTranslations('audit.levels');
  const tCommon = useTranslations('common');

  const [search, setSearch] = useState('');
  const [resource, setResource] = useState('');
  const [level, setLevel] = useState<AuditLevel | ''>('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);

  const path = auditApi.listPath({
    page,
    pageSize: PAGE_SIZE,
    search: search.trim() || undefined,
    resource: resource.trim() || undefined,
    level: level || undefined,
    dateFrom: dateFrom ? new Date(dateFrom).toISOString() : undefined,
    dateTo: dateTo ? new Date(dateTo).toISOString() : undefined,
  });

  const { data, isLoading } = useSWR<AuditLogsResponse>(path);

  const entries = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function clearFilters() {
    setSearch('');
    setResource('');
    setLevel('');
    setDateFrom('');
    setDateTo('');
    setPage(1);
  }

  if (isLoading && !data) return <PageLoader label={tCommon('loading')} />;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-text-muted">{t('subtitle')}</p>
      </header>

      <div className="grid gap-3 rounded-md border border-border bg-surface p-3 md:grid-cols-5">
        <div className="md:col-span-2">
          <Label htmlFor="audit-search">{t('filters.search')}</Label>
          <Input
            id="audit-search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="login.failed, contracts.created…"
          />
        </div>
        <div>
          <Label htmlFor="audit-resource">{t('filters.resource')}</Label>
          <Input
            id="audit-resource"
            value={resource}
            onChange={(e) => {
              setResource(e.target.value);
              setPage(1);
            }}
            placeholder={t('filters.resourcePlaceholder')}
          />
        </div>
        <div>
          <Label htmlFor="audit-level">{t('filters.level')}</Label>
          <Select
            id="audit-level"
            value={level}
            onChange={(e) => {
              setLevel(e.target.value as AuditLevel | '');
              setPage(1);
            }}
          >
            <option value="">{tCommon('all')}</option>
            <option value="INFO">{tLevel('INFO')}</option>
            <option value="WARNING">{tLevel('WARNING')}</option>
            <option value="ERROR">{tLevel('ERROR')}</option>
            <option value="SECURITY">{tLevel('SECURITY')}</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="audit-from">{t('filters.from')}</Label>
          <Input
            id="audit-from"
            type="datetime-local"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div>
          <Label htmlFor="audit-to">{t('filters.to')}</Label>
          <Input
            id="audit-to"
            type="datetime-local"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="flex items-end md:col-span-5">
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            {t('filters.clear')}
          </Button>
          <FieldHelp>
            {total} {total === 1 ? 'registro' : 'registros'}
          </FieldHelp>
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border border-border bg-surface">
        <table className="min-w-full text-sm">
          <thead className="bg-surface-muted text-left text-[11px] font-semibold uppercase tracking-wider text-text-muted">
            <tr>
              <th className="w-6 px-2 py-2"></th>
              <th className="px-3 py-2">{t('cols.when')}</th>
              <th className="px-3 py-2">{t('cols.who')}</th>
              <th className="px-3 py-2">{t('cols.action')}</th>
              <th className="px-3 py-2">{t('cols.resource')}</th>
              <th className="px-3 py-2">{t('cols.level')}</th>
              <th className="px-3 py-2">{t('cols.ip')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {entries.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-text-muted">
                  {tCommon('nothingHere')}
                </td>
              </tr>
            ) : (
              entries.map((e) => (
                <AuditRow key={e.id} entry={e} levelLabel={tLevel(e.level)} systemLabel={t('system')} />
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-2 text-xs text-text-muted">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            {tCommon('previous')}
          </Button>
          <span>
            {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            {tCommon('next')}
          </Button>
        </div>
      )}
    </div>
  );
}

function AuditRow({
  entry,
  levelLabel,
  systemLabel,
}: {
  entry: AuditLogEntry;
  levelLabel: string;
  systemLabel: string;
}) {
  const t = useTranslations('audit');
  const [open, setOpen] = useState(false);
  const who = entry.user
    ? `${entry.user.firstName} ${entry.user.lastName}`.trim() || entry.user.email
    : entry.actor ?? systemLabel;
  const hasDetails =
    !!entry.beforeState || !!entry.afterState || !!entry.metadata;

  return (
    <>
      <tr
        className={'cursor-pointer hover:bg-surface-hover ' + (open ? 'bg-surface-hover' : '')}
        onClick={() => hasDetails && setOpen((v) => !v)}
      >
        <td className="px-2 py-2 text-text-muted">
          {hasDetails ? (
            open ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )
          ) : null}
        </td>
        <td className="px-3 py-2 whitespace-nowrap text-xs text-text-muted">
          {formatDateTime(entry.createdAt)}
        </td>
        <td className="px-3 py-2">{who}</td>
        <td className="px-3 py-2 font-mono text-xs">{entry.action}</td>
        <td className="px-3 py-2 text-xs text-text-muted">
          {entry.resource ? (
            <>
              {entry.resource}
              {entry.resourceId && (
                <span className="ml-1 font-mono text-text-subtle">
                  {entry.resourceId.slice(0, 8)}
                </span>
              )}
            </>
          ) : (
            '—'
          )}
        </td>
        <td className="px-3 py-2">
          <Badge tone={LEVEL_TONE[entry.level]}>{levelLabel}</Badge>
        </td>
        <td className="px-3 py-2 font-mono text-xs text-text-muted">
          {entry.ip ?? '—'}
        </td>
      </tr>
      {open && hasDetails && (
        <tr>
          <td colSpan={7} className="bg-surface-muted px-3 py-3">
            <div className="grid gap-2 md:grid-cols-2">
              {entry.beforeState !== null && entry.beforeState !== undefined && (
                <DiffPane label={t('diff.before')} value={entry.beforeState} />
              )}
              {entry.afterState !== null && entry.afterState !== undefined && (
                <DiffPane label={t('diff.after')} value={entry.afterState} />
              )}
              {entry.metadata !== null && entry.metadata !== undefined && (
                <DiffPane
                  label={t('diff.metadata')}
                  value={entry.metadata}
                  className={
                    entry.beforeState || entry.afterState ? 'md:col-span-2' : ''
                  }
                />
              )}
              {entry.userAgent && (
                <div className="md:col-span-2 text-2xs text-text-subtle">
                  UA: <span className="font-mono">{entry.userAgent}</span>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function DiffPane({
  label,
  value,
  className,
}: {
  label: string;
  value: unknown;
  className?: string;
}) {
  return (
    <div className={'rounded bg-surface p-2 ' + (className ?? '')}>
      <div className="text-2xs uppercase tracking-wider text-text-muted">
        {label}
      </div>
      <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
