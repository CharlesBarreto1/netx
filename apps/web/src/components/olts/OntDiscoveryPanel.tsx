'use client';

/**
 * OntDiscoveryPanel — painel de descoberta de ONU (NetX como integrador técnico).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Fluxo em 3 camadas, operável por botões:
 *   1. Escanear — varre a OLT e grava as ONUs no staging (opcionalmente 1 PON).
 *   2. Casar    — cruza as ONUs com o Hubsoft por serial (MATCHED/UNMATCHED/…).
 *   3. Materializar — MATCHED → Customer+Contract+Ont (+RADIUS, salvo "sem RADIUS").
 *
 * Nada é destrutivo: o staging é revisável e a materialização respeita o status
 * do contrato (só ativos sobem autorizados no RADIUS).
 */
import { Radar, Link2, PlayCircle, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import useSWR from 'swr';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { ApiError } from '@/lib/api';
import { notify } from '@/lib/notify';
import { oltsApi, type DiscoveredOntList, type DiscoveredOntMatchState } from '@/lib/olts-api';

const STATE_TONE: Record<DiscoveredOntMatchState, 'success' | 'danger' | 'warning' | 'info' | 'neutral'> = {
  DISCOVERED: 'info',
  MATCHED: 'success',
  UNMATCHED: 'warning',
  AMBIGUOUS: 'warning',
  MATERIALIZED: 'success',
  IGNORED: 'neutral',
};

const STATE_LABEL: Record<DiscoveredOntMatchState, string> = {
  DISCOVERED: 'Descoberta',
  MATCHED: 'Casada',
  UNMATCHED: 'Sem cliente',
  AMBIGUOUS: 'Ambígua',
  MATERIALIZED: 'Materializada',
  IGNORED: 'Ignorada',
};

export function OntDiscoveryPanel({ oltId }: { oltId: string }) {
  const { data, isLoading, mutate } = useSWR<DiscoveredOntList>(oltsApi.discoveredPath());
  const [busy, setBusy] = useState<null | 'scan' | 'match' | 'materialize'>(null);
  const [scope, setScope] = useState<{ slot: string; pon: string }>({ slot: '', pon: '' });
  const [noRadius, setNoRadius] = useState(false);

  const counts = data?.byState ?? {};
  const matched = counts.MATCHED ?? 0;

  async function run<T>(kind: 'scan' | 'match' | 'materialize', fn: () => Promise<T>, done: (r: T) => string) {
    setBusy(kind);
    try {
      const r = await fn();
      notify.success(done(r));
      await mutate();
    } catch (e) {
      notify.error(
        e instanceof ApiError ? e.friendlyMessage : e instanceof Error ? e.message : 'Falhou',
      );
    } finally {
      setBusy(null);
    }
  }

  const doScan = () =>
    run(
      'scan',
      () => {
        const s = scope.slot !== '' && scope.pon !== '' ? { slot: Number(scope.slot), pon: Number(scope.pon) } : undefined;
        return oltsApi.scanOnts(oltId, s);
      },
      (r) => `Descoberta: ${r.discovered} ONUs em ${(r.durationMs / 1000).toFixed(1)}s`,
    );

  const doMatch = () =>
    run('match', () => oltsApi.matchDiscovered(), (r) => `Casamento: ${r.matched} casadas, ${r.unmatched} sem cliente`);

  const doMaterialize = () =>
    run(
      'materialize',
      () => oltsApi.materialize({ noRadius }),
      (r) => `Materializadas ${r.materialized} (${r.radiusEnqueued} no RADIUS, ${r.failed} falhas)`,
    );

  return (
    <section className="rounded-md border border-border bg-surface">
      <header className="flex flex-wrap items-center gap-2 border-b border-border p-4">
        <Radar className="h-4 w-4 text-brand-500" />
        <span className="font-semibold">Descoberta de ONU</span>
        <span className="text-xs text-text-muted">
          Varre a OLT, casa com o Hubsoft por serial e materializa em contratos.
        </span>
        <button
          onClick={() => mutate()}
          className="ml-auto text-text-muted hover:text-text"
          title="Atualizar"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      </header>

      {/* Barra de ações */}
      <div className="flex flex-wrap items-end gap-3 border-b border-border p-4">
        <div className="flex items-end gap-2">
          <label className="flex flex-col text-xs text-text-muted">
            Slot
            <input
              className="mt-1 w-16 rounded border border-border bg-surface-muted px-2 py-1 text-sm text-text"
              value={scope.slot}
              onChange={(e) => setScope((s) => ({ ...s, slot: e.target.value.replace(/\D/g, '') }))}
              placeholder="todos"
              inputMode="numeric"
            />
          </label>
          <label className="flex flex-col text-xs text-text-muted">
            PON
            <input
              className="mt-1 w-16 rounded border border-border bg-surface-muted px-2 py-1 text-sm text-text"
              value={scope.pon}
              onChange={(e) => setScope((s) => ({ ...s, pon: e.target.value.replace(/\D/g, '') }))}
              placeholder="todas"
              inputMode="numeric"
            />
          </label>
          <Button variant="primary" size="sm" loading={busy === 'scan'} disabled={!!busy} onClick={doScan}>
            <Radar className="mr-1 h-3.5 w-3.5" /> Escanear
          </Button>
        </div>

        <Button variant="secondary" size="sm" loading={busy === 'match'} disabled={!!busy} onClick={doMatch}>
          <Link2 className="mr-1 h-3.5 w-3.5" /> Casar com Hubsoft
        </Button>

        <div className="flex items-center gap-2">
          <Button
            variant="primary"
            size="sm"
            loading={busy === 'materialize'}
            disabled={!!busy || matched === 0}
            onClick={doMaterialize}
            title={matched === 0 ? 'Nenhuma ONU casada para materializar' : undefined}
          >
            <PlayCircle className="mr-1 h-3.5 w-3.5" /> Materializar {matched > 0 ? `(${matched})` : ''}
          </Button>
          <label className="flex items-center gap-1 text-xs text-text-muted" title="Cria contrato sem ativar no RADIUS">
            <input type="checkbox" checked={noRadius} onChange={(e) => setNoRadius(e.target.checked)} />
            sem RADIUS
          </label>
        </div>
      </div>

      {/* Contadores por estado */}
      {data && data.total > 0 && (
        <div className="flex flex-wrap gap-2 border-b border-border p-3">
          {(Object.keys(STATE_LABEL) as DiscoveredOntMatchState[])
            .filter((st) => counts[st])
            .map((st) => (
              <Badge key={st} tone={STATE_TONE[st]}>
                {STATE_LABEL[st]}: {counts[st]}
              </Badge>
            ))}
        </div>
      )}

      {/* Tabela do staging */}
      <div className="overflow-x-auto">
        {isLoading ? (
          <div className="flex justify-center p-8">
            <Spinner />
          </div>
        ) : !data || data.total === 0 ? (
          <p className="p-8 text-center text-sm text-text-muted">
            Nenhuma ONU descoberta ainda. Clique em <strong>Escanear</strong> para varrer a OLT.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-text-muted">
                <th className="p-2 font-medium">Serial</th>
                <th className="p-2 font-medium">Slot/PON/ONU</th>
                <th className="p-2 font-medium">Modelo</th>
                <th className="p-2 font-medium">Estado óptico</th>
                <th className="p-2 font-medium">Situação</th>
                <th className="p-2 font-medium">Cliente / nota</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((o) => (
                <tr key={o.id} className="border-b border-border/50 hover:bg-surface-hover">
                  <td className="p-2 font-mono text-xs">{o.serial}</td>
                  <td className="p-2 font-mono text-xs">
                    {o.slot}/{o.pon}/{o.onuIndex}
                  </td>
                  <td className="p-2">{o.model ?? '—'}</td>
                  <td className="p-2">{o.onuState ?? '—'}</td>
                  <td className="p-2">
                    <Badge tone={STATE_TONE[o.matchState]}>{STATE_LABEL[o.matchState]}</Badge>
                  </td>
                  <td className="p-2 text-xs text-text-muted">
                    {o.erpCustomerCode ? <span className="font-mono">cliente {o.erpCustomerCode}</span> : null}
                    {o.matchNote ? <span className="block truncate max-w-[24rem]">{o.matchNote}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
