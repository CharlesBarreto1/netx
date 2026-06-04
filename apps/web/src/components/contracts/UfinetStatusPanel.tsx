'use client';

/**
 * Painel de status do serviço Ufinet (rede neutra PY) de um contrato.
 * Hub do Atendente: read-only + botão "reprocessar" quando FAILED.
 * Não renderiza nada se o contrato não tem serviço Ufinet.
 */
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/Button';
import { Label, Select } from '@/components/ui/Input';
import { toast } from '@/components/ui/sonner';
import { ApiError, api } from '@/lib/api';
import { hasPermission } from '@/lib/session';
import {
  ufinetApi,
  type OntAction,
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
  const locale = useLocale();
  const { data, isLoading, mutate } = useSWR<UfinetService | null>(
    ufinetApi.byContractPath(contractId),
    () => ufinetApi.byContract(contractId),
  );

  const [downloading, setDownloading] = useState(false);
  const [ontBusy, setOntBusy] = useState<OntAction | null>(null);

  if (isLoading) return null;
  // Sem serviço Ufinet vinculado: oferece adoção (se houver OLT Ufinet e perm).
  if (!data) {
    return hasPermission('ufinet.orders.retry') ? (
      <UfinetAdoptCard contractId={contractId} onAdopted={() => mutate()} />
    ) : null;
  }
  const svc = data;
  const canRetry = hasPermission('ufinet.orders.retry');
  // Ações de ONT só fazem sentido depois que o serviço foi provisionado.
  const canOntActions =
    canRetry && (svc.lifecycle === 'ACTIVE' || svc.lifecycle === 'SUSPENDED');

  async function handleOntAction(action: OntAction) {
    setOntBusy(action);
    try {
      // 1) Dispara (rápido) — devolve orderId.
      const disp = await ufinetApi.ontActionDispatch(contractId, action);
      if (disp.status === 'failed' || !disp.orderId) {
        toast.error(t('ufinet.ont.failed', { error: disp.message ?? '' }));
        return;
      }
      toast.info(t('ufinet.ont.dispatched'));
      // 2) Poll do resultado (a cadeia até a ONT é lenta). ~90s no total.
      const orderId = disp.orderId;
      for (let i = 0; i < 22; i++) {
        await new Promise((r) => setTimeout(r, 4000));
        const res = await ufinetApi.ontActionResult(contractId, orderId);
        if (res.status === 'completed') {
          toast.success(t('ufinet.ont.ok'));
          // STATUS_ONT grava os níveis no banco — re-busca pra exibir a leitura
          // persistida (com timestamp). REFRESH/RESET não têm níveis.
          await mutate();
          return;
        }
        if (res.status === 'failed') {
          toast.error(t('ufinet.ont.failed', { error: res.message ?? '' }));
          return;
        }
      }
      toast.info(t('ufinet.ont.pending'));
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

      {/* Níveis ópticos — SEMPRE a última leitura persistida (STATUS_ONT), com timestamp */}
      {svc.lastSignalLevels && svc.lastSignalLevels.length > 0 && (
        <div className="mt-2 rounded-md bg-slate-50 p-2 dark:bg-slate-900">
          <div className="mb-1 flex items-center justify-between">
            <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              {t('ufinet.ont.levelsTitle')}
            </p>
            {svc.lastSignalAt && (
              <span className="text-2xs text-slate-400">
                {t('ufinet.ont.lastReadAt', {
                  when: new Date(svc.lastSignalAt).toLocaleString(locale, {
                    day: '2-digit',
                    month: '2-digit',
                    year: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  }),
                })}
              </span>
            )}
          </div>
          <div className="space-y-0.5">
            {svc.lastSignalLevels.map((c) => (
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

type OltOption = { id: string; name: string; vendor: string; providerMode: string };

/**
 * Card de adoção: aparece quando o contrato NÃO tem serviço Ufinet, mas existe
 * OLT Ufinet cadastrada. Vincula um serviço já ativo na Ufinet (cadastro manual
 * lá) — o backend consulta o inventário pelo código do contrato.
 */
function UfinetAdoptCard({
  contractId,
  onAdopted,
}: {
  contractId: string;
  onAdopted: () => void;
}) {
  const t = useTranslations('contractCards');
  const { data: olts } = useSWR<OltOption[]>('/v1/optical/olts', (k: string) =>
    api.get<OltOption[]>(k),
  );
  const ufinetOlts = (olts ?? []).filter(
    (o) => o.vendor === 'UFINET' && o.providerMode === 'ORCHESTRATOR',
  );
  const [oltId, setOltId] = useState('');
  const [busy, setBusy] = useState(false);

  // Sem OLT Ufinet cadastrada → não há o que adotar; não renderiza.
  if (ufinetOlts.length === 0) return null;

  async function handleAdopt() {
    if (!oltId) return;
    setBusy(true);
    try {
      await ufinetApi.adopt(contractId, oltId);
      toast.success(t('ufinet.adopt.ok'));
      onAdopted();
    } catch (err) {
      const msg = err instanceof ApiError ? err.friendlyMessage : (err as Error).message;
      toast.error(t('ufinet.adopt.failed', { error: msg }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-dashed border-slate-300 p-4 dark:border-slate-700">
      <h3 className="text-sm font-semibold">{t('ufinet.title')}</h3>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
        {t('ufinet.adopt.hint')}
      </p>
      <div className="mt-3 space-y-2">
        <div>
          <Label htmlFor="adopt-olt">{t('ufinet.adopt.oltLabel')}</Label>
          <Select id="adopt-olt" value={oltId} onChange={(e) => setOltId(e.target.value)}>
            <option value="">—</option>
            {ufinetOlts.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
        </div>
        <Button size="sm" loading={busy} disabled={!oltId} onClick={handleAdopt}>
          {t('ufinet.adopt.button')}
        </Button>
      </div>
    </div>
  );
}
