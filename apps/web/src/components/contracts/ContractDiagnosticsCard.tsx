'use client';

/**
 * Painel de diagnóstico do CPE (TR-069) dentro do contrato.
 *
 * Hub do Atendente: o operador vê sinal óptico (RX/TX), saúde, clientes Wi-Fi
 * e alertas abertos SEM sair da tela do cliente nem copiar serial. Leitura
 * liberada (provisioning.read); ações (coletar/reboot) só com tr069.admin.
 * Não renderiza nada se o contrato não tem CPE gerenciada.
 *
 * @provenance Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=
 */
import { Activity, ExternalLink, RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';
import useSWR from 'swr';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { notify } from '@/lib/notify';
import {
  classifyRxPower,
  tr069Api,
  type Tr069OpticalHealth,
} from '@/lib/provisioning-api';
import { hasPermission } from '@/lib/session';

const HEALTH_TONE: Record<Tr069OpticalHealth, 'success' | 'warning' | 'danger' | 'neutral'> = {
  OK: 'success',
  WARNING: 'warning',
  CRITICAL: 'danger',
  UNKNOWN: 'neutral',
};

const HEALTH_TEXT: Record<Tr069OpticalHealth, string> = {
  OK: 'text-emerald-600 dark:text-emerald-400',
  WARNING: 'text-amber-600 dark:text-amber-400',
  CRITICAL: 'text-red-600 dark:text-red-400',
  UNKNOWN: 'text-text-muted',
};

export function ContractDiagnosticsCard({ contractId }: { contractId: string }) {
  const t = useTranslations('contractCards');
  const { data, isLoading, mutate } = useSWR(
    tr069Api.byContractPath(contractId),
    () => tr069Api.byContract(contractId),
    { refreshInterval: 30_000 },
  );
  const [busy, setBusy] = useState(false);
  const canAct = hasPermission('tr069.admin');

  // Sem CPE gerenciada → não renderiza (igual ao painel Ufinet).
  if (isLoading || !data) return null;
  const d = data;
  const latest = d.latest;
  const rxHealth = classifyRxPower(latest?.rxPower ?? null);

  async function handleCollect() {
    setBusy(true);
    try {
      const res = await tr069Api.refresh(d.id);
      notify.success(t('diag.queued'), { description: res.message });
      await mutate();
    } catch (e) {
      notify.apiError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-md border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-text-muted" />
          <h3 className="text-sm font-semibold uppercase tracking-wide text-text-muted">
            {t('diag.title')}
          </h3>
          <Badge tone={d.status === 'ONLINE' ? 'success' : d.status === 'OFFLINE' ? 'danger' : 'neutral'}>
            {d.status}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          {canAct && (
            <Button size="sm" variant="secondary" loading={busy} onClick={handleCollect}>
              <RefreshCw className="mr-1 h-3.5 w-3.5" /> {t('diag.collect')}
            </Button>
          )}
          <Link
            href={`/tr069/devices/${d.id}`}
            className="inline-flex items-center gap-1 text-xs text-sky-600 hover:underline dark:text-sky-400"
          >
            {t('diag.detail')} <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
      </div>

      {!latest ? (
        <p className="mt-3 text-sm italic text-text-muted">{t('diag.noReading')}</p>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <p className="text-xs text-text-muted">{t('diag.rx')}</p>
            <p className={`text-lg font-bold ${HEALTH_TEXT[rxHealth]}`}>
              {latest.rxPower === null ? '—' : `${latest.rxPower} dBm`}
            </p>
            <Badge tone={HEALTH_TONE[latest.opticalHealth]}>
              {t(`diag.health.${latest.opticalHealth}` as 'diag.health.OK')}
            </Badge>
          </div>
          <div>
            <p className="text-xs text-text-muted">{t('diag.tx')}</p>
            <p className="text-lg font-medium text-text">
              {latest.txPower === null ? '—' : `${latest.txPower} dBm`}
            </p>
          </div>
          <div>
            <p className="text-xs text-text-muted">{t('diag.wifiClients')}</p>
            <p className="text-lg font-medium text-text">
              {(latest.wifiClients24 ?? 0) + (latest.wifiClients5 ?? 0)}
            </p>
          </div>
          <div>
            <p className="text-xs text-text-muted">{t('diag.lastReading')}</p>
            <p className="text-sm text-text">
              {d.lastDiagnosticAt ? new Date(d.lastDiagnosticAt).toLocaleString('pt-BR') : '—'}
            </p>
          </div>
        </div>
      )}

      {d.openAlerts.length > 0 && (
        <div className="mt-3 space-y-1 border-t border-border pt-3">
          {d.openAlerts.map((a) => (
            <div
              key={a.id}
              className="flex items-center gap-2 text-xs text-amber-800 dark:text-amber-200"
            >
              <Badge tone={a.severity === 'CRITICAL' ? 'danger' : 'warning'}>{a.severity}</Badge>
              <span>{a.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
