'use client';

import { Wifi, WifiOff } from 'lucide-react';
import useSWR from 'swr';

import { Badge } from '@/components/ui/Badge';
import { InlineLoader } from '@/components/ui/Spinner';
import { radacctApi, type ContractSession } from '@/lib/radacct-api';

/**
 * ContractSessionCard — status técnico do contrato (online/offline + IP +
 * uptime/downtime). Lê de radius.radacct via /v1/contracts/:id/session.
 *
 * Atualiza a cada 30s (refreshInterval) — bom o suficiente pra atendente
 * atender e ver o estado atual sem refresh manual.
 */
export function ContractSessionCard({ contractId }: { contractId: string }) {
  const { data, isLoading, error } = useSWR<ContractSession>(
    radacctApi.sessionPath(contractId),
    { refreshInterval: 30_000 },
  );

  if (isLoading && !data) return <InlineLoader label="Cargando estado…" />;
  if (error) {
    return (
      <p className="text-xs text-text-muted">
        Sin datos de RADIUS para este contrato.
      </p>
    );
  }
  if (!data) return null;

  // Sem sessão registrada — RADIUS nunca viu esse contrato.
  if (!data.sessionStart) {
    return (
      <div className="rounded-md border border-dashed border-border bg-surface p-3 text-sm text-text-muted">
        <WifiOff className="mr-1 inline-block h-3.5 w-3.5" />
        Sin actividad RADIUS registrada para este contrato.
      </div>
    );
  }

  const since = new Date(
    data.online ? data.sessionStart : data.sessionStop!,
  );
  const elapsedSec = Math.max(0, Math.floor((Date.now() - since.getTime()) / 1000));

  return (
    <div className="rounded-md border border-border bg-surface p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {data.online ? (
            <>
              <Wifi className="h-4 w-4 text-emerald-600" />
              <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                ONLINE
              </span>
            </>
          ) : (
            <>
              <WifiOff className="h-4 w-4 text-text-muted" />
              <span className="font-semibold text-text-muted">OFFLINE</span>
            </>
          )}
        </div>
        {data.framedIp && (
          <Badge tone="info">{data.framedIp}</Badge>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <Field
          label={data.online ? 'Conectado hace' : 'Desconectado hace'}
          value={formatDuration(elapsedSec)}
        />
        {data.online ? (
          <Field
            label="Sesión iniciada"
            value={since.toLocaleString('es-PY')}
          />
        ) : (
          <Field
            label="Última sesión"
            value={since.toLocaleString('es-PY')}
          />
        )}
        {!data.online && data.terminateCause && (
          <Field label="Causa" value={data.terminateCause} />
        )}
        {data.nasIp && <Field label="NAS" value={data.nasIp} />}
      </div>

      {data.uptimeSeconds > 0 && (
        <div className="border-t border-border pt-2 text-xs text-text-muted">
          Última sesión: {formatDuration(data.uptimeSeconds)} ·{' '}
          {formatBytes(data.inputBytes)} ↓ / {formatBytes(data.outputBytes)} ↑
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-2xs uppercase tracking-wider text-text-muted">
        {label}
      </div>
      <div className="font-mono">{value}</div>
    </div>
  );
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const m = mins % 60;
  if (hours < 24) return `${hours}h ${m}m`;
  const days = Math.floor(hours / 24);
  const h = hours % 24;
  return `${days}d ${h}h`;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  if (n < 1024 ** 4) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  return `${(n / 1024 ** 4).toFixed(2)} TB`;
}
