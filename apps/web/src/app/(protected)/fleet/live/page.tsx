'use client';

import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import useSWR from 'swr';

import { PageLoader } from '@/components/ui/Spinner';
import {
  fleetApi,
  type FleetLive,
  type FleetRoute,
  type LiveDotStatus,
  type LivePosition,
} from '@/lib/fleet-api';

const FleetLiveMap = dynamic(
  () => import('@/components/fleet/FleetLiveMap').then((m) => m.FleetLiveMap),
  {
    ssr: false,
    loading: () => <MapLoading />,
  },
);

function MapLoading() {
  const t = useTranslations('fleet.live');
  return (
    <div className="flex h-full items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-sm text-slate-400 dark:border-slate-700 dark:bg-slate-900/40">
      {t('loadingMap')}
    </div>
  );
}

/** Bolinha de status: verde=ligado, amarelo=ligado parado >2min, cinza=desligado, vermelho=sem sync >4h. */
const DOT_CLASS: Record<LiveDotStatus, string> = {
  ON: 'bg-green-500',
  IDLE: 'bg-yellow-400',
  OFF: 'bg-slate-400',
  STALE: 'bg-red-500',
};
const DOT_KEY: Record<LiveDotStatus, string> = {
  ON: 'legendOn',
  IDLE: 'legendIdle',
  OFF: 'legendOff',
  STALE: 'legendStale',
};

interface SpeedingEvent {
  start: string;
  end: string;
  maxSpeed: number;
}

/** datetime-local (sem timezone) no fuso do navegador. */
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function speedingEvents(route: FleetRoute, limit: number): SpeedingEvent[] {
  const out: SpeedingEvent[] = [];
  let start: string | null = null;
  let end: string | null = null;
  let max = 0;
  for (const p of route.points) {
    if ((p.speed ?? 0) > limit) {
      start ??= p.deviceTime;
      end = p.deviceTime;
      max = Math.max(max, p.speed ?? 0);
    } else if (start && end) {
      out.push({ start, end, maxSpeed: max });
      start = end = null;
      max = 0;
    }
  }
  if (start && end) out.push({ start, end, maxSpeed: max });
  return out;
}

export default function FleetLivePage() {
  const t = useTranslations('fleet.live');
  const { data, isLoading, error } = useSWR<FleetLive>(
    fleetApi.livePath(),
    () => fleetApi.getLive(),
    { refreshInterval: 7000, revalidateOnFocus: true },
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Histórico de percurso
  const [historyOpen, setHistoryOpen] = useState(false);
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return toLocalInput(d);
  });
  const [to, setTo] = useState(() => toLocalInput(new Date()));
  const [speedLimit, setSpeedLimit] = useState(80);
  const [route, setRoute] = useState<FleetRoute | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState(false);

  const positions = data?.positions ?? [];
  const counts = positions.reduce(
    (acc, p) => {
      acc[p.dot] += 1;
      return acc;
    },
    { ON: 0, IDLE: 0, OFF: 0, STALE: 0 } as Record<LiveDotStatus, number>,
  );

  const alerts = route ? speedingEvents(route, speedLimit) : [];

  async function loadRoute() {
    if (!selectedId) return;
    setRouteLoading(true);
    setRouteError(false);
    try {
      const r = await fleetApi.getVehicleRoute(
        selectedId,
        new Date(from).toISOString(),
        new Date(to).toISOString(),
      );
      setRoute(r);
    } catch {
      setRouteError(true);
      setRoute(null);
    } finally {
      setRouteLoading(false);
    }
  }

  function clearRoute() {
    setRoute(null);
    setRouteError(false);
    setHistoryOpen(false);
  }

  function selectVehicle(id: string) {
    if (id !== selectedId) {
      // trocar de veículo invalida o percurso desenhado
      setRoute(null);
      setRouteError(false);
    }
    setSelectedId(id);
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {t('subtitle')}
          </p>
        </div>
        {data && (
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
            {(Object.keys(DOT_CLASS) as LiveDotStatus[]).map((dot) => (
              <span key={dot} className="inline-flex items-center gap-1" title={t(DOT_KEY[dot])}>
                <span className={`h-2 w-2 rounded-full ${DOT_CLASS[dot]}`} /> {counts[dot]}
              </span>
            ))}
            <span>· {t('updatedAt', { time: new Date(data.generatedAt).toLocaleTimeString('pt-BR') })}</span>
          </div>
        )}
      </header>

      {data && !data.traccarConfigured && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          {t.rich('traccarNotConfigured', {
            code: (chunks) => <code>{chunks}</code>,
          })}
        </div>
      )}

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {t('loadError')}
        </div>
      )}

      {isLoading && !data && <PageLoader />}

      {data && data.trackedVehicles === 0 && (
        <p className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
          {t('noTrackedVehicles')}
        </p>
      )}

      {data && data.trackedVehicles > 0 && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
          <aside className="order-2 space-y-1 lg:order-1">
            {positions.length === 0 && (
              <p className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 text-center text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
                {t('noPositionsYet', { count: data.trackedVehicles })}
              </p>
            )}
            {positions.map((p) => (
              <VehicleRow
                key={p.vehicleId}
                p={p}
                selected={p.vehicleId === selectedId}
                onClick={() => selectVehicle(p.vehicleId)}
              />
            ))}

            {selectedId && (
              <div className="mt-3 space-y-2 rounded-md border border-slate-200 p-3 text-sm dark:border-slate-700">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{t('historyTitle')}</span>
                  {!historyOpen && (
                    <button
                      type="button"
                      onClick={() => setHistoryOpen(true)}
                      className="rounded bg-brand-600 px-2 py-1 text-xs font-medium text-white hover:bg-brand-700"
                    >
                      {t('historyShow')}
                    </button>
                  )}
                </div>

                {historyOpen && (
                  <div className="space-y-2">
                    <label className="block text-xs text-slate-500 dark:text-slate-400">
                      {t('historyFrom')}
                      <input
                        type="datetime-local"
                        value={from}
                        onChange={(e) => setFrom(e.target.value)}
                        className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-900"
                      />
                    </label>
                    <label className="block text-xs text-slate-500 dark:text-slate-400">
                      {t('historyTo')}
                      <input
                        type="datetime-local"
                        value={to}
                        onChange={(e) => setTo(e.target.value)}
                        className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-900"
                      />
                    </label>
                    <label className="block text-xs text-slate-500 dark:text-slate-400">
                      {t('historySpeedLimit')}
                      <input
                        type="number"
                        min={10}
                        max={200}
                        value={speedLimit}
                        onChange={(e) => setSpeedLimit(Number(e.target.value) || 80)}
                        className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-900"
                      />
                    </label>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={loadRoute}
                        disabled={routeLoading}
                        className="flex-1 rounded bg-brand-600 px-2 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
                      >
                        {routeLoading ? '…' : t('historyLoad')}
                      </button>
                      <button
                        type="button"
                        onClick={clearRoute}
                        className="rounded border border-slate-300 px-2 py-1.5 text-xs hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-800"
                      >
                        {t('historyClear')}
                      </button>
                    </div>

                    {routeError && (
                      <p className="text-xs text-red-600 dark:text-red-400">{t('historyLoadError')}</p>
                    )}
                    {route && route.points.length === 0 && (
                      <p className="text-xs text-slate-500">{t('historyEmpty')}</p>
                    )}
                    {route && route.truncated && (
                      <p className="text-xs text-amber-600 dark:text-amber-400">{t('historyTruncated')}</p>
                    )}

                    {route && route.points.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-xs font-semibold">
                          {t('speedingTitle', { count: alerts.length, limit: speedLimit })}
                        </p>
                        {alerts.length === 0 && (
                          <p className="text-xs text-slate-500">{t('speedingNone')}</p>
                        )}
                        {alerts.length > 0 && (
                          <ul className="max-h-40 space-y-1 overflow-y-auto">
                            {alerts.map((a, i) => (
                              <li
                                key={i}
                                className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
                              >
                                {new Date(a.start).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                                {' – '}
                                {new Date(a.end).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                                {' · '}
                                {t('speedingMax', { speed: Math.round(a.maxSpeed) })}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </aside>

          <div className="order-1 h-[60vh] lg:order-2 lg:h-[72vh]">
            <FleetLiveMap
              positions={positions}
              selectedId={selectedId}
              onSelect={selectVehicle}
              route={route}
              speedLimit={speedLimit}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function VehicleRow({
  p,
  selected,
  onClick,
}: {
  p: LivePosition;
  selected: boolean;
  onClick: () => void;
}) {
  const t = useTranslations('fleet.live');
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-start gap-2 rounded-md border p-2 text-left text-sm transition-colors ${
        selected
          ? 'border-brand-500 bg-brand-50 dark:border-brand-500 dark:bg-brand-500/10'
          : 'border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/60'
      }`}
    >
      <span
        className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${DOT_CLASS[p.dot]}`}
        title={t(DOT_KEY[p.dot])}
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">{p.plate}</span>
          {p.speed != null && p.status === 'MOVING' && (
            <span className="text-xs text-slate-500">{t('speedKmh', { speed: Math.round(p.speed) })}</span>
          )}
        </span>
        <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{p.label}</span>
        <span className="block text-xs text-slate-400">
          {t(DOT_KEY[p.dot])} · {new Date(p.deviceTime).toLocaleTimeString('pt-BR')}
        </span>
        {p.driverName && <span className="block truncate text-xs text-slate-400">{p.driverName}</span>}
      </span>
    </button>
  );
}
