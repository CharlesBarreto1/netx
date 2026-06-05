'use client';

import { Wifi, WifiOff, Power, ExternalLink } from 'lucide-react';
import { useTranslations } from 'next-intl';
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
  const t = useTranslations('contractCards');
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
        toast.success(t('session.kickedToast', { count: res.kicked }));
      } else if (res.results.length === 0) {
        toast.info(t('session.noActiveSession'));
      } else {
        // Tentou em algum NAS mas todos retornaram erro
        const firstErr = res.results.find((r) => !r.ok)?.error;
        toast.error(
          firstErr
            ? t('session.kickFailedReason', { reason: firstErr })
            : t('session.kickFailed'),
        );
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

  if (isLoading && !data) return <InlineLoader label={t('session.loadingState')} />;
  if (error) {
    return (
      <p className="text-xs text-text-muted">
        {t('session.noRadiusData')}
      </p>
    );
  }
  if (!data) return null;

  // Sem sessão registrada — RADIUS nunca viu esse contrato.
  if (!data.sessionStart) {
    return (
      <div className="rounded-md border border-dashed border-border bg-surface p-3 text-sm text-text-muted">
        <WifiOff className="mr-1 inline-block h-3.5 w-3.5" />
        {t('session.noRadiusActivity')}
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
                {t('session.online')}
              </span>
            </>
          ) : (
            <>
              <WifiOff className="h-4 w-4 text-text-muted" />
              <span className="font-semibold text-text-muted">{t('session.offline')}</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {data.framedIp && (
            <a
              href={`http://${data.framedIp}`}
              target="_blank"
              rel="noopener noreferrer"
              title={t('session.openDeviceTooltip')}
              className="inline-flex"
            >
              <Badge tone="info" className="cursor-pointer hover:opacity-80">
                {data.framedIp}
                <ExternalLink className="h-3 w-3" />
              </Badge>
            </a>
          )}
          {data.online && canKick && (
            <Button
              size="sm"
              variant="ghost"
              loading={kicking}
              onClick={() => setKickConfirmOpen(true)}
              title={t('session.kickTooltip')}
            >
              <Power className="mr-1 h-3.5 w-3.5" />
              {t('session.disconnect')}
            </Button>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={kickConfirmOpen}
        onClose={() => setKickConfirmOpen(false)}
        onConfirm={doKick}
        title={t('session.kickConfirmTitle')}
        message={t('session.kickConfirmMessage')}
        confirmLabel={t('session.disconnect')}
        variant="danger"
        loading={kicking}
      />


      <div className="grid grid-cols-2 gap-2 text-xs">
        <Field
          label={data.online ? t('session.connectedFor') : t('session.disconnectedFor')}
          value={formatDuration(elapsedSec)}
        />
        {data.online ? (
          <Field
            label={t('session.startedAt')}
            value={since.toLocaleString('es-PY')}
          />
        ) : (
          <Field
            label={t('session.lastSession')}
            value={since.toLocaleString('es-PY')}
          />
        )}
        {!data.online && data.terminateCause && (
          <Field label={t('session.cause')} value={data.terminateCause} />
        )}
        {data.nasIp && <Field label="NAS" value={data.nasIp} />}
      </div>

      {data.uptimeSeconds > 0 && (
        <div className="border-t border-border pt-2 text-xs text-text-muted">
          {t('session.lastSession')}: {formatDuration(data.uptimeSeconds)} ·{' '}
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
