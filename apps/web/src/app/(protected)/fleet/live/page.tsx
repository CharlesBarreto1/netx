'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import useSWR from 'swr';

import { PageLoader } from '@/components/ui/Spinner';
import { fleetApi, type FleetLive, type LivePosition, type LiveVehicleStatus } from '@/lib/fleet-api';

const FleetLiveMap = dynamic(
  () => import('@/components/fleet/FleetLiveMap').then((m) => m.FleetLiveMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-sm text-slate-400 dark:border-slate-700 dark:bg-slate-900/40">
        Carregando mapa…
      </div>
    ),
  },
);

const STATUS_DOT: Record<LiveVehicleStatus, string> = {
  MOVING: 'bg-green-500',
  STOPPED: 'bg-amber-500',
  OFFLINE: 'bg-slate-400',
};
const STATUS_LABEL: Record<LiveVehicleStatus, string> = {
  MOVING: 'Em movimento',
  STOPPED: 'Parado',
  OFFLINE: 'Offline',
};

export default function FleetLivePage() {
  const { data, isLoading, error } = useSWR<FleetLive>(
    fleetApi.livePath(),
    () => fleetApi.getLive(),
    { refreshInterval: 7000, revalidateOnFocus: true },
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const positions = data?.positions ?? [];
  const counts = positions.reduce(
    (acc, p) => {
      acc[p.status] += 1;
      return acc;
    },
    { MOVING: 0, STOPPED: 0, OFFLINE: 0 } as Record<LiveVehicleStatus, number>,
  );

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Ao vivo</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Posição em tempo real dos veículos com rastreador (via Traccar). Atualiza sozinho a
            cada poucos segundos.
          </p>
        </div>
        {data && (
          <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-green-500" /> {counts.MOVING}</span>
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" /> {counts.STOPPED}</span>
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-slate-400" /> {counts.OFFLINE}</span>
            <span>· atualizado {new Date(data.generatedAt).toLocaleTimeString('pt-BR')}</span>
          </div>
        )}
      </header>

      {data && !data.traccarConfigured && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          Traccar não está configurado neste ambiente (env <code>TRACCAR_URL/USER/PASSWORD</code>).
          Os veículos com rastreador aparecem com a última posição conhecida, se houver.
        </div>
      )}

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          Falha ao carregar posições.
        </div>
      )}

      {isLoading && !data && <PageLoader />}

      {data && data.trackedVehicles === 0 && (
        <p className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
          Nenhum veículo tem rastreador cadastrado. Informe o IMEI do rastreador no cadastro do
          veículo (aba Veículos) pra ele aparecer aqui.
        </p>
      )}

      {data && data.trackedVehicles > 0 && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
          <aside className="order-2 space-y-1 lg:order-1">
            {positions.length === 0 && (
              <p className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 text-center text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
                {data.trackedVehicles} veículo(s) com rastreador, mas nenhuma posição recebida
                ainda.
              </p>
            )}
            {positions.map((p) => (
              <VehicleRow
                key={p.vehicleId}
                p={p}
                selected={p.vehicleId === selectedId}
                onClick={() => setSelectedId(p.vehicleId)}
              />
            ))}
          </aside>

          <div className="order-1 h-[60vh] lg:order-2 lg:h-[72vh]">
            <FleetLiveMap positions={positions} selectedId={selectedId} onSelect={setSelectedId} />
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
      <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${STATUS_DOT[p.status]}`} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">{p.plate}</span>
          {p.speed != null && p.status === 'MOVING' && (
            <span className="text-xs text-slate-500">{Math.round(p.speed)} km/h</span>
          )}
        </span>
        <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{p.label}</span>
        <span className="block text-xs text-slate-400">
          {STATUS_LABEL[p.status]} · {new Date(p.deviceTime).toLocaleTimeString('pt-BR')}
        </span>
        {p.driverName && <span className="block truncate text-xs text-slate-400">{p.driverName}</span>}
      </span>
    </button>
  );
}
