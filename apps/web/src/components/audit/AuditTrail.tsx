'use client';

import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import useSWR from 'swr';

import { Badge } from '@/components/ui/Badge';
import { InlineLoader } from '@/components/ui/Spinner';
import { auditApi, type AuditLevel, type AuditLogEntry } from '@/lib/audit-api';
import { formatDateTime } from '@/lib/format';

const LEVEL_TONE: Record<AuditLevel, 'info' | 'warning' | 'danger' | 'success'> = {
  INFO: 'info',
  WARNING: 'warning',
  ERROR: 'danger',
  SECURITY: 'success', // verde-azulado funciona como destaque pra eventos de segurança
};

/**
 * AuditTrail — timeline de auditoria reusável.
 *
 * Modo entidade:
 *   <AuditTrail resource="contracts" resourceId={contract.id} />
 *
 * Renderiza últimos 50 eventos do recurso, com expansão pra ver before/after.
 * Pra ver tudo da operação, use a página /settings/audit (com filtros).
 */
export interface AuditTrailProps {
  resource: string;
  resourceId: string;
  limit?: number;
}

export function AuditTrail({ resource, resourceId, limit = 50 }: AuditTrailProps) {
  const t = useTranslations('audit');
  const tLevel = useTranslations('audit.levels');

  const path = auditApi.listPath({ resource, resourceId, pageSize: limit });
  const { data, isLoading } = useSWR<{ data: AuditLogEntry[]; total: number }>(
    path,
  );

  if (isLoading) {
    return <InlineLoader />;
  }

  const entries = data?.data ?? [];
  if (entries.length === 0) {
    return (
      <p className="text-sm text-text-muted">{t('trailEmpty')}</p>
    );
  }

  return (
    <ul className="space-y-2">
      {entries.map((e) => (
        <AuditEntry key={e.id} entry={e} levelLabel={tLevel(e.level)} systemLabel={t('system')} />
      ))}
    </ul>
  );
}

function AuditEntry({
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
    <li className="rounded-md border border-border bg-surface p-2.5 text-sm">
      <button
        type="button"
        onClick={() => hasDetails && setOpen((v) => !v)}
        className={
          'flex w-full items-center gap-2 text-left ' +
          (hasDetails ? 'cursor-pointer' : 'cursor-default')
        }
      >
        {hasDetails ? (
          open ? (
            <ChevronDown className="h-3.5 w-3.5 text-text-muted" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-text-muted" />
          )
        ) : (
          <span className="w-3.5" />
        )}
        <Badge tone={LEVEL_TONE[entry.level]}>{levelLabel}</Badge>
        <span className="font-mono text-xs">{entry.action}</span>
        <span className="ml-auto flex items-center gap-3 text-xs text-text-muted">
          <span>{who}</span>
          <span>{formatDateTime(entry.createdAt)}</span>
          {entry.ip && (
            <span className="font-mono">{entry.ip}</span>
          )}
        </span>
      </button>

      {open && hasDetails && (
        <div className="mt-2 grid gap-2 border-t border-border pt-2 md:grid-cols-2">
          {entry.beforeState != null && (
            <DiffPane label={t('diff.before')} value={entry.beforeState} />
          )}
          {entry.afterState != null && (
            <DiffPane label={t('diff.after')} value={entry.afterState} />
          )}
          {entry.metadata != null && (
            <DiffPane
              label={t('diff.metadata')}
              value={entry.metadata}
              className={
                entry.beforeState != null || entry.afterState != null
                  ? 'md:col-span-2'
                  : ''
              }
            />
          )}
        </div>
      )}
    </li>
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
    <div className={'rounded bg-surface-muted p-2 ' + (className ?? '')}>
      <div className="text-2xs uppercase tracking-wider text-text-muted">
        {label}
      </div>
      <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
