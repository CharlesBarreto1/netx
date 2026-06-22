'use client';

/**
 * /tr069 — Dashboard "Fila de diagnóstico" (landing do Gerenciador de CPEs).
 * KPIs da operação + fila de CPEs com alerta aberto (dados reais do ACS) +
 * breakdown de sintomas. Clicar numa linha abre a ficha do device.
 *
 * Tráfego agregado (Gbps) do handoff fica de fora por ora — o NetX não coleta
 * essa série; entra quando houver coletor de tráfego.
 */
import { RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/Button';
import { PageLoader } from '@/components/ui/Spinner';
import { sevColor } from '@/components/tr069/Charts';
import {
  tr069Api,
  type Tr069Dashboard,
  type Tr069DashboardOltCell,
} from '@/lib/provisioning-api';

const ALERT_LABEL: Record<string, string> = {
  OPTICAL_RX_LOW: 'Sinal óptico baixo',
  OPTICAL_RX_HIGH: 'Sinal óptico alto',
  OPTICAL_TX_ABNORMAL: 'TX óptico anormal',
  OPTICAL_FIBER_DEGRADED: 'Fibra degradada',
  DEVICE_OFFLINE: 'Offline / LOS',
  WIFI_WEAK_CLIENT: 'WiFi fraco',
  WIFI_HIGH_UTIL: 'WiFi congestionado',
  WAN_DOWN: 'PPPoE / WAN caiu',
};

function alertLabel(type: string): string {
  return ALERT_LABEL[type] ?? type;
}

function ago(iso: string | null): string {
  if (!iso) return '—';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'agora';
  if (mins < 60) return `há ${mins} min`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `há ${h} h`;
  return `há ${Math.floor(h / 24)} d`;
}

const DASH_VIEWS = [
  { key: 'fila', label: 'Fila' },
  { key: 'cards', label: 'Cards' },
  { key: 'mapa', label: 'Mapa OLT' },
] as const;
type DashView = (typeof DASH_VIEWS)[number]['key'];

/** Cor da célula do Mapa OLT pela fração de CPEs degradados (verde→âmbar→vermelho). */
function oltCellColor(cell: Tr069DashboardOltCell): string {
  if (cell.total === 0) return '#1d2b48';
  const ratio = cell.degraded / cell.total;
  if (ratio === 0) return '#12b886';
  if (ratio < 0.1) return '#74c69d';
  if (ratio < 0.3) return '#f59f00';
  return '#fa5252';
}

function Kpi({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 font-mono text-3xl font-semibold" style={{ color }}>
        {value.toLocaleString('pt-BR')}
      </p>
    </div>
  );
}

export default function Tr069DashboardPage() {
  const [dashView, setDashView] = useState<DashView>('fila');
  const { data, isLoading, error, mutate } = useSWR<Tr069Dashboard>(
    'tr069/dashboard',
    () => tr069Api.dashboard(),
    { refreshInterval: 30_000 },
  );

  if (isLoading) return <PageLoader />;
  if (error || !data) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
        Erro ao carregar o dashboard.
      </div>
    );
  }

  const { kpis, queue, symptoms, olts } = data;
  const maxSym = Math.max(1, ...symptoms.map((s) => s.count));

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-xs uppercase tracking-wide text-slate-400">
            Operação · Atendimento N1
          </p>
          <h1 className="text-2xl font-bold tracking-tight">Fila de diagnóstico</h1>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-slate-200 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-900">
            {DASH_VIEWS.map((v) => (
              <button
                key={v.key}
                onClick={() => setDashView(v.key)}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                  dashView === v.key
                    ? 'bg-sky-600 text-white'
                    : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>
          <Button variant="secondary" size="sm" onClick={() => mutate()}>
            <RefreshCw className="mr-1 h-4 w-4" /> Atualizar
          </Button>
        </div>
      </header>

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="CPEs online" value={kpis.online} color="#12b886" />
        <Kpi label="Offline" value={kpis.offline} color="#fa5252" />
        <Kpi label="Em alerta" value={kpis.alerta} color="#f59f00" />
        <Kpi label="Não conformes" value={kpis.naoConformes} color="#1565ff" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        {/* Modo Fila */}
        {dashView === 'fila' && (
          <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="border-b border-slate-100 px-4 py-3 dark:border-slate-800">
              <h2 className="text-sm font-semibold">CPEs com problema · {queue.length}</h2>
            </div>
            {queue.length === 0 ? (
              <p className="p-8 text-center text-sm text-slate-500">
                Nenhum CPE com alerta aberto. 🎉
              </p>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {queue.map((q) => (
                  <Link
                    key={q.deviceId}
                    href={`/tr069/devices/${q.deviceId}`}
                    className="grid grid-cols-[10px_1.6fr_1.4fr_84px_92px] items-center gap-3 px-4 py-2.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-800/50"
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ background: sevColor(q.severity) }}
                    />
                    <div className="min-w-0">
                      <p className="truncate font-medium">{q.label}</p>
                      <p className="truncate font-mono text-xs text-slate-400">{q.model ?? '—'}</p>
                    </div>
                    <div className="min-w-0">
                      <span
                        className="rounded px-1.5 py-0.5 text-[11px] font-medium"
                        style={{ background: `${sevColor(q.severity)}1a`, color: sevColor(q.severity) }}
                      >
                        {alertLabel(q.type)}
                      </span>
                      <p className="truncate text-xs text-slate-500">{q.symptom}</p>
                    </div>
                    <span className="font-mono text-xs" style={{ color: sevColor(q.severity) }}>
                      {q.signal === null ? '—' : q.signal}
                    </span>
                    <span className="text-right text-xs text-slate-400">{ago(q.lastInformAt)}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Modo Cards */}
        {dashView === 'cards' && (
          <div>
            {queue.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">
                Nenhum CPE com alerta aberto. 🎉
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {queue.map((q) => (
                  <Link
                    key={q.deviceId}
                    href={`/tr069/devices/${q.deviceId}`}
                    className="rounded-xl border border-slate-200 bg-white p-3 transition-all hover:-translate-y-0.5 hover:shadow-lg dark:border-slate-800 dark:bg-slate-900"
                    style={{ borderLeft: `3px solid ${sevColor(q.severity)}` }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{q.label}</p>
                        <p className="truncate font-mono text-xs text-slate-400">{q.model ?? '—'}</p>
                      </div>
                      <span className="shrink-0 text-xs text-slate-400">{ago(q.lastInformAt)}</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span
                        className="rounded px-1.5 py-0.5 text-[11px] font-medium"
                        style={{ background: `${sevColor(q.severity)}1a`, color: sevColor(q.severity) }}
                      >
                        {alertLabel(q.type)}
                      </span>
                      <span className="font-mono text-xs" style={{ color: sevColor(q.severity) }}>
                        {q.signal === null ? '—' : q.signal}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-xs text-slate-500">{q.symptom}</p>
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Modo Mapa OLT */}
        {dashView === 'mapa' && (
          <div className="rounded-xl border border-slate-800 bg-[#0e1726] p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-200">
              Saúde por OLT · {olts.length}
            </h2>
            {olts.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-500">
                Nenhuma OLT com CPEs gerenciados.
              </p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                  {olts.map((cell) => (
                    <div
                      key={cell.oltId}
                      className="flex aspect-square flex-col justify-between rounded-lg p-2 text-white"
                      style={{ background: oltCellColor(cell) }}
                      title={`${cell.oltName} · ${cell.degraded}/${cell.total} degradados`}
                    >
                      <span className="truncate text-[11px] font-medium opacity-90">
                        {cell.oltName}
                      </span>
                      <span className="font-mono text-sm font-semibold">
                        {cell.degraded}/{cell.total}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex items-center gap-2 text-[11px] text-slate-400">
                  <span>Saudável</span>
                  <div
                    className="h-2 flex-1 rounded-full"
                    style={{
                      background:
                        'linear-gradient(90deg,#12b886,#74c69d,#f59f00,#fa5252)',
                    }}
                  />
                  <span>Degradado</span>
                </div>
              </>
            )}
          </div>
        )}

        {/* Right rail — sintomas */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="mb-3 text-sm font-semibold">Sintomas mais comuns</h2>
          {symptoms.length === 0 ? (
            <p className="text-sm text-slate-500">Sem alertas abertos.</p>
          ) : (
            <div className="space-y-3">
              {symptoms.map((s) => (
                <div key={s.type}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-600 dark:text-slate-300">{alertLabel(s.type)}</span>
                    <span className="font-mono text-slate-400">{s.count}</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${(s.count / maxSym) * 100}%`,
                        background: s.type.startsWith('OPTICAL')
                          ? '#fa5252'
                          : s.type.startsWith('WIFI')
                            ? '#f59f00'
                            : s.type === 'DEVICE_OFFLINE'
                              ? '#7c3aed'
                              : '#1565ff',
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
