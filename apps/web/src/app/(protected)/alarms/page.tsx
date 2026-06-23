'use client';

/**
 * /alarms — Central de Alarmes CPE/OLT. Incidents correlacionados por
 * PON/CTO/cabo/OLT/bairro, com ack/resolve. Polling SWR 5s (real-time leve).
 */
import Link from 'next/link';
import { useState } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';

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
const SCOPE_LABEL: Record<string, string> = {
  ONT: 'ONT',
  PON: 'PON',
  CTO: 'CTO',
  CABLE: 'Cabo',
  OLT: 'OLT',
  GEO: 'Bairro',
};
const CAUSE_LABEL: Record<string, string> = {
  POWER_OUTAGE: 'Queda de energia',
  FIBER_CUT: 'Rompimento de fibra',
  OPTICAL_DEGRADED: 'Sinal degradado',
  ISOLATED: 'Cliente isolado',
  UNKNOWN: 'Indefinido',
};

export default function AlarmsPage() {
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
      toast.error(err instanceof ApiError ? err.friendlyMessage : 'Erro');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Central de Alarmes</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Quedas correlacionadas por PON · CTO · cabo · OLT · bairro. Atualiza a cada 5s.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={status} onChange={(e) => setStatus(e.target.value as IncidentStatus | '')}>
            <option value="OPEN">Abertos</option>
            <option value="ACK">Reconhecidos</option>
            <option value="RESOLVED">Resolvidos</option>
            <option value="">Todos</option>
          </Select>
          <Link href="/alarms/config" className="text-sm text-blue-600 hover:underline">
            Configurar limiares
          </Link>
        </div>
      </header>

      {incidents.length === 0 ? (
        <div className="rounded-lg border border-green-200 bg-green-50 p-10 text-center text-sm text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-200">
          Nenhum incidente {status === 'OPEN' ? 'aberto' : 'no filtro'}. Rede estável. ✓
        </div>
      ) : (
        <div className="space-y-2">
          {incidents.map((i) => (
            <IncidentCard
              key={i.id}
              incident={i}
              canWrite={canWrite}
              busy={busy === i.id}
              onAck={() => act(i.id, () => alarmsApi.ack(i.id), 'Reconhecido')}
              onResolve={() => act(i.id, () => alarmsApi.resolve(i.id), 'Resolvido')}
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
  return (
    <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={SEVERITY_TONE[i.severity]}>{i.severity}</Badge>
            <Badge tone="neutral">{SCOPE_LABEL[i.scope] ?? i.scope}</Badge>
            <span className="font-semibold">{i.scopeLabel}</span>
            {i.status !== 'OPEN' && <Badge tone="neutral">{i.status}</Badge>}
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            <strong>{CAUSE_LABEL[i.rootCause] ?? i.rootCause}</strong> ·{' '}
            {i.affectedCount}
            {i.totalInScope > 0 && `/${i.totalInScope}`} clientes afetados
            {i.totalInScope > 0 && ` (${i.affectedPct.toFixed(0)}%)`}
          </p>
          {i.aiSummary && (
            <p className="text-xs text-slate-500 dark:text-slate-400">🤖 {i.aiSummary}</p>
          )}
          <p className="text-[11px] text-slate-400">
            desde {new Date(i.firstEventAt).toLocaleString()}
          </p>
        </div>
        {canWrite && i.status !== 'RESOLVED' && (
          <div className="flex gap-2">
            {i.status === 'OPEN' && (
              <Button variant="secondary" disabled={busy} onClick={onAck}>
                Reconhecer
              </Button>
            )}
            <Button disabled={busy} onClick={onResolve}>
              Resolver
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
