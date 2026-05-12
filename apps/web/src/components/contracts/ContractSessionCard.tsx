'use client';

import { Wifi, WifiOff, Power } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import useSWR, { mutate } from 'swr';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Modal';
import { InlineLoader } from '@/components/ui/Spinner';
import { ApiError } from '@/lib/api';
import { contractsApi } from '@/lib/contracts-api';
import { radacctApi, type ContractSession } from '@/lib/radacct-api';
import { hasPermission } from '@/lib/session';

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

  const canKick = hasPermission('contracts.write');
  const [kickConfirmOpen, setKickConfirmOpen] = useState(false);
  const [kicking, setKicking] = useState(false);

  async function doKick() {
    setKicking(true);
    try {
      const res = await contractsApi.kick(contractId);
      if (res.kicked > 0) {
        toast.success(`Cliente desconectado em ${res.kicked} NAS(es).`);
      } else if (res.results.length === 0) {
        toast.info('Cliente não tem sessão ativa para desconectar.');
      } else {
        // Tentou em algum NAS mas todos retornaram erro
        const firstErr = res.results.find((r) => !r.ok)?.error;
        toast.error(`Falha ao desconectar${firstErr ? `: ${firstErr}` : ''}`);
      }
      // Recarrega o status técnico — em 3s o radacct deve refletir a queda
      await mutate(radacctApi.sessionPath(contractId));
      setKickConfirmOpen(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.friendlyMessage : (err as Error).message);
    } finally {
      setKicking(false);
    }
  }

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
      <div className="flex items-center justify-between gap-2">
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
        <div className="flex items-center gap-2">
          {data.framedIp && <Badge tone="info">{data.framedIp}</Badge>}
          {data.online && canKick && (
            <Button
              size="sm"
              variant="ghost"
              loading={kicking}
              onClick={() => setKickConfirmOpen(true)}
              title="Forçar desconexão (CoA Disconnect-Request)"
            >
              <Power className="mr-1 h-3.5 w-3.5" />
              Desconectar
            </Button>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={kickConfirmOpen}
        onClose={() => setKickConfirmOpen(false)}
        onConfirm={doKick}
        title="Desconectar cliente?"
        message="Manda Disconnect-Request pro concentrador. O cliente reconecta automaticamente se RADIUS aceitar."
        confirmLabel="Desconectar"
        variant="danger"
        loading={kicking}
      />


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
