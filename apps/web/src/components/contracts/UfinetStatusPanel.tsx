'use client';

/**
 * Painel de status do serviço Ufinet (rede neutra PY) de um contrato.
 * Hub do Atendente: read-only + botão "reprocessar" quando FAILED.
 * Não renderiza nada se o contrato não tem serviço Ufinet.
 */
import { useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api';
import { hasPermission } from '@/lib/session';
import { ufinetApi, type UfinetLifecycle, type UfinetService } from '@/lib/ufinet-api';

function badgeClass(lc: UfinetLifecycle): string {
  if (lc === 'ACTIVE') return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
  if (lc === 'FAILED') return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
  if (lc === 'CANCELLED' || lc === 'CEASED' || lc === 'SUSPENDED')
    return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300';
  // transientes
  return 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200';
}

const LIFECYCLE_LABEL: Record<UfinetLifecycle, string> = {
  PENDING_PROVIDE: 'Aguardando alta',
  PROVIDING: 'Reservando porta…',
  RESERVED: 'Porta reservada (aguarda ONT)',
  CONFIRMING_ONT: 'Confirmando ONT…',
  CONFIRMING_SERVICE: 'Confirmando serviço…',
  ACTIVE: 'Ativo',
  SUSPENDING: 'Suspendendo…',
  SUSPENDED: 'Suspenso',
  REACTIVATING: 'Reativando…',
  CEASING: 'Dando baja…',
  CEASED: 'Baixado',
  CANCELLING: 'Cancelando…',
  CANCELLED: 'Cancelado',
  FAILED: 'Falhou',
};

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
  const { data, isLoading, mutate } = useSWR<UfinetService | null>(
    ufinetApi.byContractPath(contractId),
    () => ufinetApi.byContract(contractId),
  );

  const [downloading, setDownloading] = useState(false);

  if (isLoading || !data) return null;
  const svc = data;
  const canRetry = hasPermission('ufinet.orders.retry');

  async function handleRetry() {
    try {
      await ufinetApi.retry(svc.id);
      toast.success('Serviço Ufinet reenfileirado');
      await mutate();
    } catch (err) {
      const msg = err instanceof ApiError ? err.friendlyMessage : (err as Error).message;
      toast.error(`Falha ao reprocessar: ${msg}`);
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
      toast.error(`Falha ao baixar trace: ${msg}`);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Ufinet (rede neutra)</h3>
        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${badgeClass(svc.lifecycle)}`}>
          {LIFECYCLE_LABEL[svc.lifecycle]}
        </span>
      </div>
      <div className="space-y-0 text-sm">
        <Row label="Identificador / marquilha" value={svc.externalId} />
        <Row label="Polígono / OLT" value={svc.oltName} />
        <Row label="Perfil de banda" value={svc.bandwidthProfile} />
        <Row label="Ordem (serviceOrderId)" value={svc.serviceOrderId} />
        <Row label="Caixa (CTO)" value={svc.ctoPort} />
        <Row label="Porta (interno)" value={svc.dropPort} />
        <Row label="ONT (SN)" value={svc.serialNumber} />
        <Row label="Estado Ufinet" value={svc.ufinetState} />
        {svc.waitingCode && svc.waitingCode !== '0' && (
          <Row label="waitingCode (trabalho de campo)" value={svc.waitingCode} />
        )}
      </div>
      {svc.lifecycle === 'FAILED' && svc.error && (
        <p className="mt-2 rounded-md bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">
          {svc.error}
        </p>
      )}
      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" variant="outline" loading={downloading} onClick={handleDownloadTrace}>
          Baixar trace (evidência)
        </Button>
        {svc.lifecycle === 'FAILED' && canRetry && (
          <Button size="sm" variant="secondary" onClick={handleRetry}>
            Reprocessar
          </Button>
        )}
      </div>
    </div>
  );
}
