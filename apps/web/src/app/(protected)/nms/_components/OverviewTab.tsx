'use client';

/**
 * Aba "Visão geral" — dashboard de telemetria do device (SNMP/TimescaleDB).
 * Porta o `Dashboard` do SPA standalone: saúde do sistema, óptica RX/TX,
 * eventos recentes (traps) e interfaces ativas/com tráfego. Refresh ao vivo.
 */
import { useMemo, useState } from 'react';
import { RadarIcon, RefreshCw, Search } from 'lucide-react';
import useSWR from 'swr';

import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { notify } from '@/lib/notify';
import { nmsApi } from '@/lib/nms-api';

import { bps, opticalClass, severityDotClass, speed, statusDotClass, tempClass } from '../_lib/format';

const REFRESH_MS = 30_000;

export function OverviewTab({
  deviceId,
  vendor,
  canWrite,
}: {
  deviceId: string;
  vendor: string;
  canWrite: boolean;
}) {
  const [busy, setBusy] = useState<'snmp' | 'discover' | 'anomaly' | null>(null);

  const ifaces = useSWR(`nms/${deviceId}/interfaces`, () => nmsApi.interfaces(deviceId), {
    refreshInterval: REFRESH_MS,
  });
  const rates = useSWR(`nms/${deviceId}/rates`, () => nmsApi.rates(deviceId), {
    refreshInterval: REFRESH_MS,
  });
  const optical = useSWR(`nms/${deviceId}/optical`, () => nmsApi.optical(deviceId), {
    refreshInterval: REFRESH_MS,
  });
  const system = useSWR(`nms/${deviceId}/system`, () => nmsApi.system(deviceId), {
    refreshInterval: REFRESH_MS,
  });
  const events = useSWR(`nms/${deviceId}/events`, () => nmsApi.events(deviceId), {
    refreshInterval: REFRESH_MS,
  });

  const rateByName = useMemo(
    () => new Map((rates.data ?? []).map((r) => [r.ifName, r])),
    [rates.data],
  );
  const rows = useMemo(
    () =>
      (ifaces.data ?? [])
        .map((i) => ({ ...i, rate: rateByName.get(i.name) }))
        .filter((i) => i.operStatus === 'up' || i.rate?.inBps || i.rate?.outBps)
        .sort(
          (a, b) =>
            Number(b.rate?.inBps ?? 0) +
            Number(b.rate?.outBps ?? 0) -
            Number(a.rate?.inBps ?? 0) -
            Number(a.rate?.outBps ?? 0),
        )
        .slice(0, 15),
    [ifaces.data, rateByName],
  );

  const sysReadings = (system.data ?? []).filter((s) => (s.tempC ?? 0) > 0);

  async function action(
    kind: 'snmp' | 'discover' | 'anomaly',
    fn: () => Promise<unknown>,
    okMsg: string,
  ) {
    setBusy(kind);
    try {
      await fn();
      notify.success(okMsg);
      void ifaces.mutate();
      void events.mutate();
    } catch (e) {
      notify.apiError(e);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      {canWrite && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            loading={busy === 'snmp'}
            onClick={() =>
              void action('snmp', () => nmsApi.syncSnmp(deviceId), 'SNMP sincronizado (Telegraf).')
            }
          >
            <RefreshCw className="h-4 w-4" /> Sincronizar SNMP
          </Button>
          <Button
            variant="secondary"
            size="sm"
            loading={busy === 'discover'}
            onClick={() =>
              void action(
                'discover',
                () => nmsApi.discoverInterfaces(deviceId),
                'Descoberta de interfaces enfileirada.',
              )
            }
          >
            <Search className="h-4 w-4" /> Descobrir interfaces
          </Button>
          <Button
            variant="secondary"
            size="sm"
            loading={busy === 'anomaly'}
            onClick={() =>
              void action(
                'anomaly',
                () => nmsApi.anomalyScan(deviceId),
                'Varredura de anomalias concluída.',
              )
            }
          >
            <RadarIcon className="h-4 w-4" /> Escanear anomalias
          </Button>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {/* Saúde do sistema */}
        <Card>
          <CardHeader>
            <CardTitle>Saúde do sistema</CardTitle>
          </CardHeader>
          <CardContent>
            {sysReadings.length === 0 ? (
              <p className="text-sm text-slate-500">Sem leituras recentes (device coletando?)</p>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {sysReadings.map((s) => (
                  <div
                    key={s.component}
                    className="rounded-md border border-slate-200 p-3 dark:border-slate-700"
                  >
                    <div className="truncate text-xs text-slate-500">{s.component}</div>
                    <div className={`text-xl font-semibold ${tempClass(s.tempC)}`}>
                      {s.tempC ?? '—'}°C
                    </div>
                    <div className="text-xs text-slate-500">CPU {s.cpuPct ?? '—'}%</div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Óptica */}
        <Card>
          <CardHeader>
            <CardTitle>Óptica (luz RX / TX)</CardTitle>
          </CardHeader>
          <CardContent>
            {(optical.data ?? []).length === 0 ? (
              <p className="text-sm text-slate-500">Sem leituras ópticas recentes</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-slate-500">
                    <tr>
                      <th className="py-1 pr-2 font-medium">Interface</th>
                      <th className="py-1 px-2 text-right font-medium">RX dBm</th>
                      <th className="py-1 px-2 text-right font-medium">TX dBm</th>
                      <th className="py-1 pl-2 text-right font-medium">Temp</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(optical.data ?? []).map((o) => (
                      <tr key={o.ifName} className="border-t border-slate-100 dark:border-slate-800">
                        <td className="py-1 pr-2 font-mono">{o.ifName}</td>
                        <td className={`py-1 px-2 text-right ${opticalClass(o.rxDbm)}`}>
                          {o.rxDbm ?? '—'}
                        </td>
                        <td className={`py-1 px-2 text-right ${opticalClass(o.txDbm)}`}>
                          {o.txDbm ?? '—'}
                        </td>
                        <td className="py-1 pl-2 text-right text-slate-500">
                          {o.moduleTempC ?? '—'}°C
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Interfaces */}
      <Card>
        <CardHeader>
          <CardTitle>Interfaces (ativas / com tráfego)</CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-slate-500">
              Nenhuma interface ativa com dados — rode discovery e aguarde a coleta.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-slate-500">
                  <tr>
                    <th className="py-1 pr-2 font-medium">Interface</th>
                    <th className="py-1 px-2 font-medium">Descrição</th>
                    <th className="py-1 px-2 font-medium">Status</th>
                    <th className="py-1 px-2 text-right font-medium">Speed</th>
                    <th className="py-1 px-2 text-right font-medium">↓ In</th>
                    <th className="py-1 px-2 text-right font-medium">↑ Out</th>
                    <th className="py-1 pl-2 text-right font-medium">Erros</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((i) => {
                    const errs = (i.rate?.inErrors ?? 0) + (i.rate?.outErrors ?? 0);
                    return (
                      <tr key={i.name} className="border-t border-slate-100 dark:border-slate-800">
                        <td className="py-1 pr-2 font-mono">{i.name}</td>
                        <td className="py-1 px-2 text-slate-500">{i.description ?? '—'}</td>
                        <td className="py-1 px-2">
                          <span className="inline-flex items-center gap-1.5">
                            <span className={`h-2 w-2 rounded-full ${statusDotClass(i.operStatus)}`} />
                            {i.operStatus}
                          </span>
                        </td>
                        <td className="py-1 px-2 text-right">{speed(i.speedBps)}</td>
                        <td className="py-1 px-2 text-right font-mono">{bps(i.rate?.inBps ?? null)}</td>
                        <td className="py-1 px-2 text-right font-mono">{bps(i.rate?.outBps ?? null)}</td>
                        <td
                          className={`py-1 pl-2 text-right ${errs > 0 ? 'text-amber-600 dark:text-amber-400' : ''}`}
                        >
                          {errs}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Eventos */}
      <Card>
        <CardHeader>
          <CardTitle>Eventos recentes (traps SNMP)</CardTitle>
        </CardHeader>
        <CardContent>
          {(events.data ?? []).length === 0 ? (
            <p className="text-sm text-slate-500">
              Nenhum trap recebido (configure o device p/ enviar a este coletor:162).
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-slate-500">
                  <tr>
                    <th className="py-1 pr-2 font-medium">Quando</th>
                    <th className="py-1 px-2 font-medium">Severidade</th>
                    <th className="py-1 px-2 font-medium">Tipo</th>
                    <th className="py-1 px-2 font-medium">Detalhe</th>
                    <th className="py-1 pl-2 font-medium">Origem</th>
                  </tr>
                </thead>
                <tbody>
                  {(events.data ?? []).slice(0, 12).map((e, idx) => (
                    <tr key={idx} className="border-t border-slate-100 dark:border-slate-800">
                      <td className="py-1 pr-2 whitespace-nowrap">
                        {new Date(e.ts).toLocaleString()}
                      </td>
                      <td className="py-1 px-2">
                        <span className="inline-flex items-center gap-1.5">
                          <span className={`h-2 w-2 rounded-full ${severityDotClass(e.severity)}`} />
                          {e.severity}
                        </span>
                      </td>
                      <td className="py-1 px-2">{e.type}</td>
                      <td className="py-1 px-2 text-slate-500">{e.message ?? '—'}</td>
                      <td className="py-1 pl-2 font-mono text-slate-500">{e.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-2 text-xs text-slate-400">Vendor: {vendor}</p>
        </CardContent>
      </Card>
    </div>
  );
}
