'use client';

/**
 * Painel de status do serviço Ufinet (rede neutra PY) de um contrato.
 * Hub do Atendente: read-only + botão "reprocessar" quando FAILED.
 * Não renderiza nada se o contrato não tem serviço Ufinet.
 */
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api';
import { hasPermission } from '@/lib/session';
import {
  ufinetApi,
  type OntAction,
  type OntActionResult,
  type UfinetLifecycle,
  type UfinetService,
} from '@/lib/ufinet-api';

function badgeClass(lc: UfinetLifecycle): string {
  if (lc === 'ACTIVE') return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
  if (lc === 'FAILED') return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
  if (lc === 'CANCELLED' || lc === 'CEASED' || lc === 'SUSPENDED')
    return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300';
  // transientes
  return 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200';
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex justify-between gap-4 py-0.5">
      <span className="text-slate-500 dark:text-slate-400">{label}</span>
      <span className="font-mono text-xs">{value}</span>
    </div>
  );
}

export function UfinetStatusPanel({ contractId }: { contractId: string }) {
  const t = useTranslations('contractCards');
  const { data, isLoading, mutate } = useSWR<UfinetService | null>(
    ufinetApi.byContractPath(contractId),
    () => ufinetApi.byContract(contractId),
  );

  const [downloading, setDownloading] = useState(false);
  const [ontBusy, setOntBusy] = useState<OntAction | null>(null);
  const [levels, setLevels] = useState<OntActionResult | null>(null);

  if (isLoading || !data) return null;
  const svc = data;
  const canRetry = hasPermission('ufinet.orders.retry');
  // Ações de ONT só fazem sentido depois que o serviço foi provisionado.
  const canOntActions =
    canRetry && (svc.lifecycle === 'ACTIVE' || svc.lifecycle === 'SUSPENDED');

  async function handleOntAction(action: OntAction) {
    setOntBusy(action);
    setLevels(null);
    try {
      const res = await ufinetApi.ontAction(contractId, action);
      if (res.status === 'failed') {
        toast.error(t('ufinet.ont.failed', { error: res.message ?? '' }));
      } else if (res.status === 'pending') {
        toast.info(t('ufinet.ont.pending'));
      } else {
        toast.success(t('ufinet.ont.ok'));
        if (action === 'STATUS_ONT') setLevels(res);
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.friendlyMessage : (err as Error).message;
      toast.error(t('ufinet.ont.failed', { error: msg }));
    } finally {
      setOntBusy(null);
    }
  }

  async function handleRetry() {
    try {
      await ufinetApi.retry(svc.id);
      toast.success(t('ufinet.requeued'));
      await mutate();
    } catch (err) {
      const msg = err instanceof ApiError ? err.friendlyMessage : (err as Error).message;
      toast.error(t('ufinet.retryFailed', { error: msg }));
    }
  }

  async function handleDownloadTrace() {
    setDownloading(true);
    try {
      const entries = await ufinetApi.trace(svc.id);
      const doc = {
        externalId: svc.externalId,
        contractId,
        oltName: svc.oltName,
        serviceOrderId: svc.serviceOrderId,
        generatedAt: new Date().toISOString(),
        entries,
      };
      const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ufinet-trace-${svc.externalId}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      const msg = err instanceof ApiError ? err.friendlyMessage : (err as Error).message;
      toast.error(t('ufinet.traceFailed', { error: msg }));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">{t('ufinet.title')}</h3>
        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${badgeClass(svc.lifecycle)}`}>
          {t(`ufinet.lifecycle.${svc.lifecycle}`)}
        </span>
      </div>
      <div className="space-y-0 text-sm">
        <Row label={t('ufinet.externalId')} value={svc.externalId} />
        <Row label={t('ufinet.oltName')} value={svc.oltName} />
        <Row label={t('ufinet.bandwidthProfile')} value={svc.bandwidthProfile} />
        <Row label={t('ufinet.serviceOrderId')} value={svc.serviceOrderId} />
        <Row label={t('ufinet.ctoPort')} value={svc.ctoPort} />
        <Row label={t('ufinet.dropPort')} value={svc.dropPort} />
        <Row label={t('ufinet.serialNumber')} value={svc.serialNumber} />
        <Row label={t('ufinet.ufinetState')} value={svc.ufinetState} />
        {svc.waitingCode && svc.waitingCode !== '0' && (
          <Row label={t('ufinet.waitingCode')} value={svc.waitingCode} />
        )}
      </div>
      {svc.lifecycle === 'FAILED' && svc.error && (
        <p className="mt-2 rounded-md bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">
          {svc.error}
        </p>
      )}

      {/* Níveis ópticos retornados por STATUS_ONT */}
      {levels && levels.characteristics.length > 0 && (
        <div className="mt-2 rounded-md bg-slate-50 p-2 dark:bg-slate-900">
          <p className="mb-1 text-xs font-semibold text-slate-600 dark:text-slate-300">
            {t('ufinet.ont.levelsTitle')}
          </p>
          <div className="space-y-0.5">
            {levels.characteristics.map((c) => (
              <Row key={c.name} label={c.name} value={c.value} />
            ))}
          </div>
        </div>
      )}

      {/* Ações de manutenção da ONT (só com serviço ativo) */}
      {canOntActions && (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
          <Button
            size="sm"
            variant="outline"
            loading={ontBusy === 'STATUS_ONT'}
            disabled={ontBusy !== null}
            onClick={() => handleOntAction('STATUS_ONT')}
          >
            {t('ufinet.ont.signal')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            loading={ontBusy === 'REFRESH_ONT'}
            disabled={ontBusy !== null}
            onClick={() => handleOntAction('REFRESH_ONT')}
          >
            {t('ufinet.ont.refresh')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            loading={ontBusy === 'RESET_ONT'}
            disabled={ontBusy !== null}
            onClick={() => handleOntAction('RESET_ONT')}
          >
            {t('ufinet.ont.reset')}
          </Button>
        </div>
      )}

      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" variant="outline" loading={downloading} onClick={handleDownloadTrace}>
          {t('ufinet.downloadTrace')}
        </Button>
        {svc.lifecycle === 'FAILED' && canRetry && (
          <Button size="sm" variant="secondary" onClick={handleRetry}>
            {t('ufinet.reprocess')}
          </Button>
        )}
      </div>
    </div>
  );
}
