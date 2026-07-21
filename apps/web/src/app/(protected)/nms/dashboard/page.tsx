'use client';

/**
 * /nms/dashboard — painel do NOC.
 *
 * Uma chamada só (`/v1/nms-dashboard`): o Core agrega sessões RADIUS, planta
 * óptica, OLTs e incidentes do próprio banco, e busca a telemetria da frota no
 * NMS. Buscar bloco a bloco faria o operador ler instantes diferentes lado a
 * lado como se fossem o mesmo momento.
 *
 * Refresh: 60s. A leitura mais cara é a contagem de sessões (cruza `contracts ×
 * radius.radacct`); um intervalo curto martelaria o banco sem ganho — uma queda
 * em massa de PPPoE leva minutos pra se materializar de qualquer jeito.
 */
import { AlertTriangle, Activity, Gauge, RefreshCw, Server, Signal, Waves } from 'lucide-react';
import Link from 'next/link';
import useSWR from 'swr';

import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageLoader } from '@/components/ui/Spinner';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { hasPermission } from '@/lib/session';
import { nmsDashboardApi, type NmsDashboard } from '@/lib/nms-dashboard-api';

import { Meter, Sparkline, StackedBar, StatTile } from '../_components/DashboardTiles';
import { ago, count, rxClass, severityPillClass } from '../_lib/dashboard-format';
import { bps } from '../_lib/format';

const REFRESH_MS = 60_000;

export default function NmsDashboardPage() {
  const canRead = hasPermission('network.read');

  const { data, error, isLoading, mutate, isValidating } = useSWR<NmsDashboard>(
    canRead ? 'nms-dashboard' : null,
    () => nmsDashboardApi.get(),
    {
      refreshInterval: REFRESH_MS,
      // Mantém o render anterior durante o refetch — sem isso a tela pisca
      // esqueleto a cada minuto, que numa tela de parede é insuportável.
      keepPreviousData: true,
    },
  );

  if (!canRead) {
    return (
      <EmptyState
        icon={Gauge}
        title="Sem acesso ao painel"
        description="Você precisa da permissão network.read para ver a saúde da rede."
      />
    );
  }

  if (isLoading && !data) return <PageLoader />;

  if (error && !data) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Não foi possível carregar o painel"
        description="O serviço não respondeu. Tente novamente em instantes."
        action={{ label: 'Tentar de novo', onClick: () => void mutate() }}
      />
    );
  }

  if (!data) return null;

  const { sessions, traffic, devices, optical, olts, capacity, incidents, alarms } = data;
  const trafficNow =
    traffic.inBps === null || traffic.outBps === null ? null : traffic.inBps + traffic.outBps;

  return (
    <div className="flex flex-col gap-5">
      {/* ── Cabeçalho ─────────────────────────────────────────────────── */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-text-strong">Painel do NOC</h1>
          <p className="text-xs text-text-muted">
            Atualizado {ago(data.generatedAt)} · atualiza sozinho a cada minuto
          </p>
        </div>
        <Button
          variant="secondary"
          onClick={() => void mutate()}
          disabled={isValidating}
          aria-label="Atualizar agora"
        >
          <RefreshCw className={isValidating ? 'size-4 animate-spin' : 'size-4'} />
          Atualizar
        </Button>
      </header>

      {/* ── Alarmes ───────────────────────────────────────────────────── */}
      {alarms.length > 0 && (
        <section aria-label="Alarmes ativos" className="flex flex-col gap-2">
          {alarms.map((a) => (
            <div
              key={a.kind}
              className="flex items-start gap-3 rounded-lg border border-border bg-surface p-3"
            >
              {/* Ícone + rótulo textual: a severidade nunca depende só da cor. */}
              <span
                className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-semibold ${severityPillClass(a.severity)}`}
              >
                <AlertTriangle className="size-3" aria-hidden />
                {a.severity === 'CRITICAL' ? 'Crítico' : a.severity === 'WARNING' ? 'Atenção' : 'Info'}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-text-strong">{a.title}</p>
                <p className="text-xs text-text-muted">{a.detail}</p>
              </div>
            </div>
          ))}
        </section>
      )}

      {!data.nmsAvailable && (
        <p className="rounded-lg border border-border bg-warning-muted px-3 py-2 text-xs text-warning">
          O módulo NMS não respondeu — tráfego e frota aparecem como indisponíveis. Os blocos de
          PPPoE, óptica e OLTs seguem atualizados.
        </p>
      )}

      {/* ── Números de topo ───────────────────────────────────────────── */}
      <section aria-label="Indicadores principais" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="PPPoE ativos"
          value={sessions.active}
          deltaPct={sessions.deltaPct}
          upIsGood
          baselineNote={
            sessions.baseline === null
              ? 'sem baseline ainda'
              : `baseline 1h: ${count(sessions.baseline)} · ${count(sessions.contracts)} contratos ativos`
          }
        >
          <Sparkline data={traffic.series.map((s) => s.activeSessions)} className="text-accent" />
        </StatTile>

        <StatTile
          label="Tráfego agregado"
          value={trafficNow === null ? null : bps(trafficNow)}
          deltaPct={traffic.deltaPct}
          // Aqui a seta não tem moral: subida brusca é tão suspeita quanto
          // queda. Neutro evita pintar de verde um pico que é problema.
          upIsGood="neutral"
          baselineNote={
            traffic.baselineBps === null
              ? 'sem baseline ainda'
              : `↓ ${bps(traffic.inBps)} · ↑ ${bps(traffic.outBps)}`
          }
        >
          <Sparkline
            data={traffic.series
              .filter((s) => s.totalInBps !== null && s.totalOutBps !== null)
              .map((s) => (s.totalInBps ?? 0) + (s.totalOutBps ?? 0))}
            className="text-accent"
          />
        </StatTile>

        <StatTile
          label="Dispositivos online"
          value={devices.online}
          unit={devices.total === null ? undefined : `de ${count(devices.total)}`}
          tone={devices.offline && devices.offline > 0 ? 'danger' : 'default'}
          baselineNote={
            devices.desynced > 0
              ? `${count(devices.desynced)} equipamento(s) não sincronizado(s) com o NMS`
              : devices.staleTelemetry > 0
                ? `${count(devices.staleTelemetry)} com telemetria atrasada`
                : 'todos sincronizados'
          }
        >
          <Meter
            value={devices.online ?? 0}
            total={devices.total ?? 0}
            className={devices.offline && devices.offline > 0 ? 'bg-warning' : 'bg-success'}
          />
        </StatTile>

        <StatTile
          label="OLTs online"
          value={olts.online}
          unit={`de ${count(olts.total)}`}
          tone={olts.offline > 0 ? 'danger' : 'default'}
          baselineNote={
            olts.offline > 0 ? `${count(olts.offline)} inacessível(is)` : 'todas respondendo'
          }
        >
          <Meter
            value={olts.online}
            total={olts.total}
            className={olts.offline > 0 ? 'bg-danger' : 'bg-success'}
          />
        </StatTile>
      </section>

      {/* ── Saúde óptica + OLTs ───────────────────────────────────────── */}
      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Signal className="size-4 text-text-muted" aria-hidden />
              Saúde óptica
            </CardTitle>
            <p className="text-xs text-text-muted">
              Faixa boa entre {optical.rxLowDbm} e {optical.rxHighDbm} dBm ·{' '}
              {count(optical.measured)} ONT(s) com leitura
            </p>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <StackedBar
              segments={[
                { label: 'Boa', value: optical.ok, className: 'bg-success' },
                { label: 'Fraca', value: optical.low, className: 'bg-warning' },
                { label: 'Saturada', value: optical.high, className: 'bg-accent' },
                { label: 'Sem sinal', value: optical.critical, className: 'bg-danger' },
              ]}
            />

            {optical.worst.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <caption className="sr-only">ONTs com pior sinal óptico</caption>
                  <thead>
                    <tr className="text-left text-text-subtle">
                      <th className="py-1 font-medium">ONT</th>
                      <th className="py-1 font-medium">OLT</th>
                      <th className="py-1 text-right font-medium">RX</th>
                      <th className="py-1 text-right font-medium">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {optical.worst.map((o) => (
                      <tr key={o.ontId} className="border-t border-border">
                        {/* Sem link: o Assinante 360 é busca por cliente, não
                            rota profunda por contrato — não há URL estável pra
                            apontar. O SN identifica a ONT pro operador buscar. */}
                        <td className="py-1.5 font-mono text-text">{o.snGpon}</td>
                        <td className="py-1.5 text-text-muted">{o.oltName}</td>
                        <td
                          className={`py-1.5 text-right font-mono tabular-nums ${rxClass(o.rxDbm, optical.rxLowDbm, optical.rxHighDbm)}`}
                        >
                          {o.rxDbm === null ? '—' : `${o.rxDbm.toFixed(1)} dBm`}
                        </td>
                        <td className="py-1.5 text-right text-text-muted">{o.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-xs text-text-subtle">Nenhuma ONT fora da faixa. 🎉</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Server className="size-4 text-text-muted" aria-hidden />
              Saúde das OLTs
            </CardTitle>
            <p className="text-xs text-text-muted">{count(olts.total)} OLT(s) cadastrada(s)</p>
          </CardHeader>
          <CardContent>
            {olts.items.length === 0 ? (
              <p className="text-xs text-text-subtle">Nenhuma OLT cadastrada.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {olts.items.map((o) => (
                  <li key={o.id} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <Link
                        href={`/olts/${o.id}`}
                        className="truncate text-sm font-medium text-text hover:text-accent hover:underline"
                      >
                        {o.name}
                      </Link>
                      <p className="text-2xs text-text-subtle">
                        {o.vendor} · {count(o.ontsOnline)}/{count(o.ontsTotal)} ONTs online ·{' '}
                        {ago(o.lastSeenAt)}
                      </p>
                    </div>
                    <StatusBadge
                      status={
                        o.status === 'ONLINE' ? 'online' : o.status === 'UNKNOWN' ? 'offline' : 'error'
                      }
                      label={o.status}
                      subtle
                    />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>

      {/* ── Capacidade + incidentes ───────────────────────────────────── */}
      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Waves className="size-4 text-text-muted" aria-hidden />
              Maiores consumidores
            </CardTitle>
            <p className="text-xs text-text-muted">Tráfego agora, por dispositivo</p>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {capacity.topDevices.length === 0 ? (
              <p className="text-xs text-text-subtle">
                {data.nmsAvailable ? 'Sem tráfego medido.' : 'NMS indisponível.'}
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {capacity.topDevices.map((d) => {
                  const top = capacity.topDevices[0]?.totalBps || 1;
                  return (
                    <li key={d.id} className="flex flex-col gap-1">
                      <div className="flex items-baseline justify-between gap-2 text-xs">
                        <Link
                          href={`/nms/devices/${d.id}`}
                          className="truncate font-medium text-text hover:text-accent hover:underline"
                        >
                          {d.hostname}
                        </Link>
                        <span className="shrink-0 font-mono tabular-nums text-text-muted">
                          {bps(d.totalBps)}
                        </span>
                      </div>
                      <Meter value={d.totalBps} total={top} className="bg-accent" />
                    </li>
                  );
                })}
              </ul>
            )}

            {capacity.hot.length > 0 && (
              <div className="border-t border-border pt-3">
                <p className="mb-1.5 text-2xs font-medium text-text-muted">CPU / temperatura alta</p>
                <ul className="flex flex-col gap-1">
                  {capacity.hot.map((d) => (
                    <li key={d.id} className="flex justify-between gap-2 text-xs">
                      <span className="truncate text-text">{d.hostname}</span>
                      <span className="shrink-0 font-mono tabular-nums text-warning">
                        {d.cpuPct != null && `${d.cpuPct.toFixed(0)}% CPU`}
                        {d.cpuPct != null && d.tempC != null && ' · '}
                        {d.tempC != null && `${d.tempC.toFixed(0)}°C`}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="size-4 text-text-muted" aria-hidden />
              Incidentes abertos
            </CardTitle>
            <p className="text-xs text-text-muted">Correlacionados por CTO, PON, cabo e OLT</p>
          </CardHeader>
          <CardContent>
            {incidents.length === 0 ? (
              <p className="text-xs text-text-subtle">Nenhum incidente aberto.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {incidents.map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-text">{i.scopeLabel}</p>
                      <p className="text-2xs text-text-subtle">
                        {i.scope} · {i.rootCause} · {count(i.affectedCount)}/{count(i.totalInScope)}{' '}
                        afetados · {ago(i.lastEventAt)}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-2xs font-semibold ${
                        i.severity === 'CRITICAL'
                          ? 'bg-danger-muted text-danger'
                          : i.severity === 'WARNING'
                            ? 'bg-warning-muted text-warning'
                            : 'bg-accent-muted text-accent'
                      }`}
                    >
                      {i.severity}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
