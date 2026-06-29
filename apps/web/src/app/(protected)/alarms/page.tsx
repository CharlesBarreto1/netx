'use client';

/**
 * /alarms — Central de Alarmes CPE/OLT. Incidents correlacionados por
 * PON/CTO/cabo/OLT/bairro, com ack/resolve. Polling SWR 5s (real-time leve).
 */
import Link from 'next/link';
import { useState } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Select } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import { ApiError } from '@/lib/api';
import { hasPermission } from '@/lib/session';
import {
  alarmsApi,
  type Incident,
  type IncidentSeverity,
  type IncidentStatus,
} from '@/lib/alarms-api';

const SEVERITY_TONE: Record<IncidentSeverity, 'danger' | 'warning' | 'neutral'> = {
  CRITICAL: 'danger',
  WARNING: 'warning',
  INFO: 'neutral',
};

export default function AlarmsPage() {
  const t = useTranslations('alarms');
  const tCommon = useTranslations('common');
  const canWrite = hasPermission('provisioning.write');
  const [status, setStatus] = useState<IncidentStatus | ''>('OPEN');
  const { data, isLoading, mutate } = useSWR(
    ['alarms-incidents', status],
    () => alarmsApi.listIncidents({ pageSize: 100, status: status || undefined }),
    { refreshInterval: 5_000 },
  );
  const [busy, setBusy] = useState<string | null>(null);

  if (isLoading) return <PageLoader />;
  const incidents = data?.data ?? [];

  async function act(id: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(id);
    try {
      await fn();
      toast.success(ok);
      await mutate();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.friendlyMessage : tCommon('error'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('list.title')}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {t('list.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={status} onChange={(e) => setStatus(e.target.value as IncidentStatus | '')}>
            <option value="OPEN">{t('list.filter.open')}</option>
            <option value="ACK">{t('list.filter.ack')}</option>
            <option value="RESOLVED">{t('list.filter.resolved')}</option>
            <option value="">{tCommon('all')}</option>
          </Select>
          <Link href="/alarms/config" className="text-sm text-blue-600 hover:underline">
            {t('list.configureThresholds')}
          </Link>
        </div>
      </header>

      {incidents.length === 0 ? (
        <div className="rounded-lg border border-green-200 bg-green-50 p-10 text-center text-sm text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-200">
          {status === 'OPEN' ? t('list.emptyOpen') : t('list.emptyFiltered')}
        </div>
      ) : (
        <div className="space-y-2">
          {incidents.map((i) => (
            <IncidentCard
              key={i.id}
              incident={i}
              canWrite={canWrite}
              busy={busy === i.id}
              onAck={() => act(i.id, () => alarmsApi.ack(i.id), t('list.toast.acked'))}
              onResolve={() => act(i.id, () => alarmsApi.resolve(i.id), t('list.toast.resolved'))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function IncidentCard({
  incident: i,
  canWrite,
  busy,
  onAck,
  onResolve,
}: {
  incident: Incident;
  canWrite: boolean;
  busy: boolean;
  onAck: () => void;
  onResolve: () => void;
}) {
  const t = useTranslations('alarms');
  const scopeKeys = ['ONT', 'PON', 'CTO', 'CABLE', 'OLT', 'GEO'];
  const causeKeys = ['POWER_OUTAGE', 'FIBER_CUT', 'OPTICAL_DEGRADED', 'ISOLATED', 'UNKNOWN'];
  const scopeLabel = scopeKeys.includes(i.scope) ? t(`list.scope.${i.scope}`) : i.scope;
  const causeLabel = causeKeys.includes(i.rootCause) ? t(`list.cause.${i.rootCause}`) : i.rootCause;
  return (
    <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={SEVERITY_TONE[i.severity]}>{i.severity}</Badge>
            <Badge tone="neutral">{scopeLabel}</Badge>
            <span className="font-semibold">{i.scopeLabel}</span>
            {i.status !== 'OPEN' && <Badge tone="neutral">{i.status}</Badge>}
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            <strong>{causeLabel}</strong> ·{' '}
            {i.totalInScope > 0
              ? t('list.affectedOfTotal', {
                  count: i.affectedCount,
                  total: i.totalInScope,
                  pct: i.affectedPct.toFixed(0),
                })
              : t('list.affected', { count: i.affectedCount })}
          </p>
          {i.aiSummary && (
            <p className="text-xs text-slate-500 dark:text-slate-400">🤖 {i.aiSummary}</p>
          )}
          <p className="text-[11px] text-slate-400">
            {t('list.since', { date: new Date(i.firstEventAt).toLocaleString() })}
          </p>
        </div>
        {canWrite && i.status !== 'RESOLVED' && (
          <div className="flex gap-2">
            {i.status === 'OPEN' && (
              <Button variant="secondary" disabled={busy} onClick={onAck}>
                {t('list.actions.ack')}
              </Button>
            )}
            <Button disabled={busy} onClick={onResolve}>
              {t('list.actions.resolve')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
