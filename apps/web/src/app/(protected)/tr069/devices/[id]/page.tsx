'use client';

/**
 * /tr069/devices/[id] — detalhe técnico + diagnóstico proativo de um CPE.
 *
 * Mostra o último diagnóstico coletado via TR-069 (níveis ópticos GPON +
 * experiência Wi-Fi), tendência de RX, alertas abertos, dados do equipamento
 * e as tasks recentes. Ações: coletar diagnóstico agora (GET_PARAMS) e
 * reiniciar o CPE (Reboot) — ambas aplicadas no próximo Inform.
 */
import { ArrowLeft, Gauge, HardDriveDownload, Network, RefreshCw, RotateCcw, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import useSWR from 'swr';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageLoader } from '@/components/ui/Spinner';
import { notify } from '@/lib/notify';
import {
  classifyRxPower,
  tr069Api,
  type Tr069AlertSeverity,
  type Tr069DiagnosticDto,
  type Tr069OpticalHealth,
} from '@/lib/provisioning-api';

const HEALTH_TONE: Record<Tr069OpticalHealth, 'success' | 'warning' | 'danger' | 'neutral'> = {
  OK: 'success',
  WARNING: 'warning',
  CRITICAL: 'danger',
  UNKNOWN: 'neutral',
};

const SEVERITY_TONE: Record<Tr069AlertSeverity, 'info' | 'warning' | 'danger'> = {
  INFO: 'info',
  WARNING: 'warning',
  CRITICAL: 'danger',
};

function fmt(n: number | null | undefined, unit: string): string {
  return n === null || n === undefined ? '—' : `${n} ${unit}`;
}

/** Cor do RSSI Wi-Fi: ≥-65 bom, -65..-75 atenção, <-75 ruim. */
function rssiClass(rssi: number | null): string {
  if (rssi === null) return 'text-slate-500';
  if (rssi >= -65) return 'text-emerald-600 dark:text-emerald-400';
  if (rssi >= -75) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-600 dark:text-red-400';
}

/** Sparkline SVG puro da série de RX (sem dependência de chart lib). */
function RxSparkline({ points }: { points: number[] }) {
  if (points.length < 2) return null;
  const w = 240;
  const h = 48;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const path = points
    .map((v, i) => {
      const x = (i / (points.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg width={w} height={h} className="overflow-visible">
      <path d={path} fill="none" stroke="currentColor" strokeWidth={1.5} className="text-sky-500" />
    </svg>
  );
}

export default function Tr069DeviceDetailPage() {
  const t = useTranslations('tr069');
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [busy, setBusy] = useState(false);

  const { data, isLoading, error, mutate } = useSWR(
    id ? `tr069/devices/${id}` : null,
    () => tr069Api.getDevice(id),
    { refreshInterval: 30_000 },
  );

  const { data: history } = useSWR(
    id ? `tr069/devices/${id}/diagnostics` : null,
    () => tr069Api.diagnostics(id, 50),
    { refreshInterval: 60_000 },
  );

  const { data: runs, mutate: mutateRuns } = useSWR(
    id ? `tr069/devices/${id}/diag-runs` : null,
    () => tr069Api.diagRuns(id),
    { refreshInterval: 10_000 },
  );

  async function handleRefresh() {
    setBusy(true);
    try {
      const res = await tr069Api.refresh(id);
      notify.success(t('detail.queued'), { description: res.message });
      await mutate();
    } catch (e) {
      notify.apiError(e);
    } finally {
      setBusy(false);
    }
  }

  async function handleReboot() {
    if (!window.confirm(t('detail.rebootConfirm'))) return;
    setBusy(true);
    try {
      await tr069Api.reboot(id);
      notify.success(t('detail.queued'));
      await mutate();
    } catch (e) {
      notify.apiError(e);
    } finally {
      setBusy(false);
    }
  }

  async function handleSpeedTest() {
    setBusy(true);
    try {
      const res = await tr069Api.speedTest(id);
      notify.success(res.message);
      await mutateRuns();
    } catch (e) {
      notify.apiError(e);
    } finally {
      setBusy(false);
    }
  }

  async function handlePing() {
    const host = window.prompt(t('detail.pingPrompt'), '8.8.8.8');
    if (!host) return;
    setBusy(true);
    try {
      const res = await tr069Api.ping(id, host);
      notify.success(res.message);
      await mutateRuns();
    } catch (e) {
      notify.apiError(e);
    } finally {
      setBusy(false);
    }
  }

  async function handleFirmware() {
    const url = window.prompt(t('detail.firmwarePrompt'));
    if (!url) return;
    setBusy(true);
    try {
      await tr069Api.firmwareUpgrade(id, { url });
      notify.success(t('detail.queued'));
      await mutate();
    } catch (e) {
      notify.apiError(e);
    } finally {
      setBusy(false);
    }
  }

  if (isLoading) return <PageLoader />;
  if (error || !data) {
    return (
      <div className="space-y-4">
        <Link href="/tr069/devices" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
          <ArrowLeft className="h-4 w-4" /> {t('detail.back')}
        </Link>
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {t('detail.notFound')}
        </div>
      </div>
    );
  }

  const d = data;
  const latest = d.latest;
  const lastDiagTask = d.recentTasks.find((task) => task.action === 'GET_PARAMS');
  const rxPoints = (history ?? [])
    .map((h: Tr069DiagnosticDto) => h.rxPower)
    .filter((v): v is number => v !== null)
    .reverse();

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <Link
            href="/tr069/devices"
            className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
          >
            <ArrowLeft className="h-4 w-4" /> {t('detail.back')}
          </Link>
          <h1 className="font-mono text-xl font-bold tracking-tight">{d.deviceId}</h1>
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Badge tone={d.status === 'ONLINE' ? 'success' : d.status === 'OFFLINE' ? 'danger' : 'neutral'}>
              {d.status}
            </Badge>
            {d.ont && <span className="font-mono text-xs">SN {d.ont.snGpon}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" loading={busy} onClick={handleRefresh}>
            <RefreshCw className="mr-1 h-4 w-4" /> {t('detail.refresh')}
          </Button>
          <Button variant="secondary" size="sm" loading={busy} onClick={handleSpeedTest}>
            <Gauge className="mr-1 h-4 w-4" /> {t('detail.speedTest')}
          </Button>
          <Button variant="secondary" size="sm" loading={busy} onClick={handlePing}>
            <Network className="mr-1 h-4 w-4" /> {t('detail.ping')}
          </Button>
          <Button variant="outline" size="sm" loading={busy} onClick={handleReboot}>
            <RotateCcw className="mr-1 h-4 w-4" /> {t('detail.reboot')}
          </Button>
          <Button variant="outline" size="sm" loading={busy} onClick={handleFirmware}>
            <HardDriveDownload className="mr-1 h-4 w-4" /> {t('detail.firmware')}
          </Button>
        </div>
      </div>

      {/* Alertas abertos */}
      {d.openAlerts.length > 0 && (
        <div className="space-y-2">
          {d.openAlerts.map((a) => (
            <div
              key={a.id}
              className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200"
            >
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="flex-1">
                <span className="mr-2">
                  <Badge tone={SEVERITY_TONE[a.severity]}>{a.severity}</Badge>
                </span>
                {a.message}
              </div>
            </div>
          ))}
        </div>
      )}

      {!latest ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-6 text-center text-sm dark:border-slate-800 dark:bg-slate-900">
          {lastDiagTask?.status === 'FAILED' ? (
            <div className="text-red-700 dark:text-red-300">
              <p className="font-medium">{t('detail.diagFailed')}</p>
              <p className="mt-1 font-mono text-xs">{lastDiagTask.error ?? '—'}</p>
            </div>
          ) : lastDiagTask?.status === 'RUNNING' ? (
            <p className="text-slate-500 dark:text-slate-400">{t('detail.diagRunning')}</p>
          ) : lastDiagTask?.status === 'PENDING' ? (
            <p className="text-slate-500 dark:text-slate-400">{t('detail.diagPending')}</p>
          ) : lastDiagTask?.status === 'DONE' ? (
            <p className="text-amber-700 dark:text-amber-300">{t('detail.diagEmpty')}</p>
          ) : (
            <p className="text-slate-500 dark:text-slate-400">{t('detail.noDiagnostic')}</p>
          )}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Óptico */}
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>{t('detail.sectionOptical')}</CardTitle>
              <Badge tone={HEALTH_TONE[latest.opticalHealth]}>
                {t(`detail.health.${latest.opticalHealth}` as 'detail.health.OK')}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Metric
                  label={t('detail.rxPower')}
                  value={fmt(latest.rxPower, 'dBm')}
                  tone={HEALTH_TONE[classifyRxPower(latest.rxPower)]}
                  big
                />
                <Metric label={t('detail.txPower')} value={fmt(latest.txPower, 'dBm')} big />
                <Metric label={t('detail.temperature')} value={fmt(latest.temperature, '°C')} />
                <Metric label={t('detail.voltage')} value={fmt(latest.voltage, 'V')} />
                <Metric label={t('detail.bias')} value={fmt(latest.biasCurrent, 'mA')} />
              </div>
              {/* Qualidade do enlace GPON — FEC/HEC subindo = fibra degradando */}
              {(latest.fecErrors !== null || latest.hecErrors !== null) && (
                <div className="grid grid-cols-2 gap-4 border-t border-slate-100 pt-3 dark:border-slate-800 sm:grid-cols-4">
                  <Metric label="FEC" value={fmt(latest.fecErrors, '')} />
                  <Metric label="HEC" value={fmt(latest.hecErrors, '')} />
                  <Metric label={t('detail.dropRate')} value={fmt(latest.dropRate, '')} />
                  <Metric label={t('detail.errorRate')} value={fmt(latest.errorRate, '')} />
                </div>
              )}
              {rxPoints.length >= 2 && (
                <div className="border-t border-slate-100 pt-3 dark:border-slate-800">
                  <p className="mb-1 text-xs text-slate-500">{t('detail.rxTrend')}</p>
                  <RxSparkline points={rxPoints} />
                </div>
              )}
            </CardContent>
          </Card>

          {/* Wi-Fi */}
          <Card>
            <CardHeader>
              <CardTitle>{t('detail.sectionWifi')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <Metric label={t('detail.clients24')} value={fmt(latest.wifiClients24, '')} big />
                <Metric label={t('detail.clients5')} value={fmt(latest.wifiClients5, '')} big />
                <Metric
                  label={t('detail.worstRssi')}
                  value={fmt(latest.wifiWorstRssi, 'dBm')}
                  tone={
                    latest.wifiWorstRssi === null
                      ? 'neutral'
                      : latest.wifiWorstRssi >= -65
                        ? 'success'
                        : latest.wifiWorstRssi >= -75
                          ? 'warning'
                          : 'danger'
                  }
                  big
                />
                <Metric label={`${t('detail.channel')} 2.4 GHz`} value={fmt(latest.wifiChannel24, '')} />
                <Metric label={`${t('detail.channel')} 5 GHz`} value={fmt(latest.wifiChannel5, '')} />
              </div>

              <div className="border-t border-slate-100 pt-3 dark:border-slate-800">
                <p className="mb-2 text-xs text-slate-500">{t('detail.connectedDevices')}</p>
                {latest.wifiClients.length === 0 ? (
                  <p className="text-sm text-slate-500">{t('detail.noClients')}</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="text-left text-slate-500">
                        <tr>
                          <th className="py-1 pr-2 font-medium">{t('detail.colMac')}</th>
                          <th className="py-1 pr-2 font-medium">{t('detail.colBand')}</th>
                          <th className="py-1 pr-2 font-medium">{t('detail.colRssi')}</th>
                          <th className="py-1 pr-2 font-medium">{t('detail.colRate')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {latest.wifiClients.map((c, i) => (
                          <tr key={c.mac ?? i}>
                            <td className="py-1 pr-2 font-mono">{c.mac ?? '—'}</td>
                            <td className="py-1 pr-2">{c.band}</td>
                            <td className={`py-1 pr-2 font-medium ${rssiClass(c.rssi)}`}>
                              {c.rssi === null ? '—' : `${c.rssi} dBm`}
                            </td>
                            <td className="py-1 pr-2 text-slate-500">
                              {c.rxRate ?? c.txRate ? `${c.rxRate ?? '—'}/${c.txRate ?? '—'}` : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Equipamento + tasks */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('detail.sectionInfo')}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-y-2 text-sm">
              <Info label={t('detail.manufacturer')} value={d.manufacturer} />
              <Info label={t('detail.model')} value={d.productClass} />
              <Info label={t('detail.hwVersion')} value={d.hardwareVersion} />
              <Info label={t('detail.swVersion')} value={d.softwareVersion} />
              <Info
                label={t('detail.lastInform')}
                value={d.lastInformAt ? new Date(d.lastInformAt).toLocaleString('pt-BR') : null}
              />
              <Info label={t('detail.informReason')} value={d.lastInformReason} />
              <Info
                label={t('detail.lastDiagnostic')}
                value={d.lastDiagnosticAt ? new Date(d.lastDiagnosticAt).toLocaleString('pt-BR') : null}
              />
              {d.ont && <Info label={t('detail.snGpon')} value={d.ont.snGpon} mono />}
              {latest?.pppStatus != null && (
                <Info label={t('detail.wanStatus')} value={latest.pppStatus} />
              )}
              {latest?.pppLastError != null && (
                <Info label={t('detail.wanError')} value={latest.pppLastError} />
              )}
              {latest?.hostsCount != null && (
                <Info label={t('detail.hostsCount')} value={String(latest.hostsCount)} />
              )}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('detail.sectionTasks')}</CardTitle>
          </CardHeader>
          <CardContent>
            {d.recentTasks.length === 0 ? (
              <p className="text-sm text-slate-500">{t('detail.noTasks')}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-left text-slate-500">
                    <tr>
                      <th className="py-1 pr-2 font-medium">{t('detail.colAction')}</th>
                      <th className="py-1 pr-2 font-medium">{t('detail.colStatus')}</th>
                      <th className="py-1 pr-2 font-medium">{t('detail.colCreated')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {d.recentTasks.map((task) => (
                      <tr key={task.id}>
                        <td className="py-1 pr-2 font-mono">{task.action}</td>
                        <td className="py-1 pr-2">
                          <Badge
                            tone={
                              task.status === 'DONE'
                                ? 'success'
                                : task.status === 'FAILED'
                                  ? 'danger'
                                  : task.status === 'RUNNING'
                                    ? 'info'
                                    : 'neutral'
                            }
                          >
                            {task.status}
                          </Badge>
                        </td>
                        <td className="py-1 pr-2 text-slate-500">
                          {new Date(task.createdAt).toLocaleString('pt-BR')}
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

      {/* Diagnósticos sob demanda (TR-143) */}
      {runs && runs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t('detail.sectionDiagRuns')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-left text-slate-500">
                  <tr>
                    <th className="py-1 pr-2 font-medium">{t('detail.diagKind')}</th>
                    <th className="py-1 pr-2 font-medium">{t('detail.diagResult')}</th>
                    <th className="py-1 pr-2 font-medium">{t('detail.colStatus')}</th>
                    <th className="py-1 pr-2 font-medium">{t('detail.colCreated')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {runs.map((r) => (
                    <tr key={r.id}>
                      <td className="py-1 pr-2 font-medium">
                        {r.kind === 'PING' ? `Ping ${r.target ?? ''}` : t('detail.speedTest')}
                      </td>
                      <td className="py-1 pr-2 font-mono">
                        {r.state === 'ERROR'
                          ? (r.errorText ?? '—')
                          : r.kind === 'PING'
                            ? r.pingAvgMs !== null
                              ? `${r.pingAvgMs} ms · ${r.pingSuccess ?? 0}/${(r.pingSuccess ?? 0) + (r.pingFailure ?? 0)} ok`
                              : '…'
                            : r.throughputKbps !== null
                              ? `${(r.throughputKbps / 1000).toFixed(1)} Mbps`
                              : '…'}
                      </td>
                      <td className="py-1 pr-2">
                        <Badge
                          tone={
                            r.state === 'COMPLETED' ? 'success' : r.state === 'ERROR' ? 'danger' : 'warning'
                          }
                        >
                          {r.state}
                        </Badge>
                      </td>
                      <td className="py-1 pr-2 text-slate-500">
                        {new Date(r.createdAt).toLocaleString('pt-BR')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
  big,
}: {
  label: string;
  value: string;
  tone?: 'success' | 'warning' | 'danger' | 'neutral';
  big?: boolean;
}) {
  const color =
    tone === 'success'
      ? 'text-emerald-600 dark:text-emerald-400'
      : tone === 'warning'
        ? 'text-amber-600 dark:text-amber-400'
        : tone === 'danger'
          ? 'text-red-600 dark:text-red-400'
          : 'text-slate-900 dark:text-slate-100';
  return (
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`${big ? 'text-2xl font-bold' : 'text-base font-medium'} ${color}`}>{value}</p>
    </div>
  );
}

function Info({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <>
      <dt className="text-slate-500">{label}</dt>
      <dd className={`text-right ${mono ? 'font-mono text-xs' : ''}`}>{value ?? '—'}</dd>
    </>
  );
}
