'use client';

/**
 * /tr069/devices/[id] — Ficha do CPE (Gerenciador de CPEs).
 *
 * Cabeçalho com cliente + ações remotas, banner crítico, e abas:
 *   Visão geral · Diagnóstico · WiFi · Histórico.
 * Reaproveita os dados do ACS (óptico GPON, Wi-Fi, PPPoE, conformidade,
 * cliente, série de RX, TR-143) e o chart kit (gauges, line chart, RSSI).
 */
import {
  ArrowLeft,
  Gauge as GaugeIcon,
  HardDriveDownload,
  Network,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import useSWR from 'swr';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Modal } from '@/components/ui/Modal';
import { PageLoader } from '@/components/ui/Spinner';
import { Gauge, LineChart, RssiBars, TR069_COLORS } from '@/components/tr069/Charts';
import { notify } from '@/lib/notify';
import {
  COMPLIANCE_META,
  provisioningApi,
  tr069Api,
  type Tr069AlertSeverity,
  type Tr069DiagnosticDto,
  type Tr069DriftStatus,
  type Tr069OpticalHealth,
} from '@/lib/provisioning-api';

const DRIFT_LABEL: Record<Tr069DriftStatus, string> = {
  OPEN: 'Divergente',
  REMEDIATING: 'Corrigindo',
  PENDING_REBOOT: 'Aguardando reboot',
  FAILED: 'Falhou',
  RESOLVED: 'Resolvido',
};

const TABS = [
  { key: 'geral', label: 'Visão geral' },
  { key: 'diag', label: 'Diagnóstico' },
  { key: 'wifi', label: 'WiFi' },
  { key: 'hist', label: 'Histórico' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

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

function shortParam(p: string): string {
  return p
    .replace('InternetGatewayDevice.', '')
    .replace(/WANDevice\.1\.WANConnectionDevice\.\d+\.WANPPPConnection\.1\./, 'WAN.')
    .replace('LANDevice.1.WLANConfiguration.', 'WLAN.');
}
function fmt(n: number | null | undefined, unit: string): string {
  return n === null || n === undefined ? '—' : `${n} ${unit}`;
}
function num(n: number | null | undefined): string {
  return n === null || n === undefined ? '—' : String(n);
}
function rssiClass(rssi: number | null): string {
  if (rssi === null) return 'text-slate-500';
  if (rssi >= -65) return 'text-emerald-600 dark:text-emerald-400';
  if (rssi >= -75) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-600 dark:text-red-400';
}
function uptime(secs: number | null | undefined): string {
  if (secs === null || secs === undefined) return '—';
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function Tr069DeviceDetailPage() {
  const t = useTranslations('tr069');
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<TabKey>('geral');
  const [modal, setModal] = useState<'reboot' | 'firmware' | 'reprovision' | null>(null);
  const [fwUrl, setFwUrl] = useState('');

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
  const { data: compliance, mutate: mutateCompliance } = useSWR(
    id ? `tr069/devices/${id}/compliance` : null,
    () => tr069Api.deviceCompliance(id),
    { refreshInterval: 30_000 },
  );
  const { data: deviceParams } = useSWR(
    id ? `tr069/devices/${id}/parameters` : null,
    () => tr069Api.deviceParameters(id),
  );
  const [paramSearch, setParamSearch] = useState('');
  const [paramPage, setParamPage] = useState(0);

  async function withBusy(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      notify.apiError(e);
    } finally {
      setBusy(false);
    }
  }
  const handleReconcile = () =>
    withBusy(async () => {
      const res = await tr069Api.reconcile(id);
      notify.success('Reconciliação executada', { description: res.message });
      await Promise.all([mutate(), mutateCompliance()]);
    });
  const handleRefresh = () =>
    withBusy(async () => {
      const res = await tr069Api.refresh(id);
      notify.success(t('detail.queued'), { description: res.message });
      await mutate();
    });
  const handleReboot = () =>
    withBusy(async () => {
      await tr069Api.reboot(id);
      setModal(null);
      notify.success(t('detail.queued'));
      await mutate();
    });
  const handleReprovision = () =>
    withBusy(async () => {
      const contractId = data?.customer?.contractId;
      if (!contractId) return;
      await provisioningApi.reprovision(contractId);
      setModal(null);
      notify.success('Reprovisionamento enfileirado');
      await mutate();
    });
  const handleSpeedTest = () =>
    withBusy(async () => {
      const res = await tr069Api.speedTest(id);
      notify.success(res.message);
      await mutateRuns();
    });
  const handlePing = () =>
    withBusy(async () => {
      const host = window.prompt(t('detail.pingPrompt'), '8.8.8.8');
      if (!host) return;
      const res = await tr069Api.ping(id, host);
      notify.success(res.message);
      await mutateRuns();
    });
  const handleFirmware = () =>
    withBusy(async () => {
      if (!fwUrl.trim()) return;
      await tr069Api.firmwareUpgrade(id, { url: fwUrl.trim() });
      setModal(null);
      setFwUrl('');
      notify.success(t('detail.queued'));
      await mutate();
    });

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
  const cust = d.customer;
  const isStale = (() => {
    const ts = d.lastInformAt ?? d.lastDiagnosticAt;
    return ts ? Date.now() - new Date(ts).getTime() > 5 * 60_000 : false;
  })();
  const critical =
    latest?.opticalHealth === 'CRITICAL' || d.openAlerts.some((a) => a.severity === 'CRITICAL');
  const rxPoints = (history ?? [])
    .map((h: Tr069DiagnosticDto) => h.rxPower)
    .filter((v): v is number => v !== null)
    .reverse();
  const lastDiagTask = d.recentTasks.find((task) => task.action === 'GET_PARAMS');
  const paramList = (deviceParams ?? []).filter((p) =>
    `${p.name} ${p.value}`.toLowerCase().includes(paramSearch.toLowerCase()),
  );
  const PARAM_PAGE_SIZE = 50;
  const paramPages = Math.max(1, Math.ceil(paramList.length / PARAM_PAGE_SIZE));
  const paramSlice = paramList.slice(paramPage * PARAM_PAGE_SIZE, (paramPage + 1) * PARAM_PAGE_SIZE);

  return (
    <div className="space-y-5">
      <Link href="/tr069/devices" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft className="h-4 w-4" /> {t('detail.back')}
      </Link>

      {/* Header card — cliente + ações */}
      <Card>
        <CardContent className="flex flex-wrap items-start justify-between gap-4 pt-6">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-xl font-bold tracking-tight">
                {cust ? cust.customerName : d.deviceId}
              </h1>
              <Badge tone={d.status === 'ONLINE' ? 'success' : d.status === 'OFFLINE' ? 'danger' : 'neutral'}>
                {d.status}
              </Badge>
            </div>
            <p className="flex flex-wrap gap-x-2 font-mono text-xs text-slate-500">
              {cust && (
                <>
                  <Link href={`/customers/${cust.customerId}`} className="text-sky-600 hover:underline dark:text-sky-400">
                    cliente
                  </Link>
                  <span>·</span>
                  <Link href={`/contracts/${cust.contractId}`} className="text-sky-600 hover:underline dark:text-sky-400">
                    {cust.contractCode ?? 'contrato'}
                  </Link>
                  <span>·</span>
                  <span>{cust.pppoeUsername ?? '—'}</span>
                  <span>·</span>
                </>
              )}
              <span>{d.productClass ?? d.manufacturer ?? '—'}</span>
              {d.ont && (
                <>
                  <span>·</span>
                  <span>SN {d.ont.snGpon}</span>
                </>
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" loading={busy} onClick={handleRefresh}>
              <RefreshCw className="mr-1 h-4 w-4" /> {t('detail.refresh')}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setModal('reboot')}>
              <RotateCcw className="mr-1 h-4 w-4" /> {t('detail.reboot')}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setModal('firmware')}>
              <HardDriveDownload className="mr-1 h-4 w-4" /> {t('detail.firmware')}
            </Button>
            {cust && (
              <Button variant="outline" size="sm" onClick={() => setModal('reprovision')}>
                <RefreshCw className="mr-1 h-4 w-4" /> Reprovisionar
              </Button>
            )}
            <Button variant="secondary" size="sm" loading={busy} onClick={handleReconcile}>
              <ShieldCheck className="mr-1 h-4 w-4" /> Reconciliar
            </Button>
          </div>
        </CardContent>
      </Card>

      {critical && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {latest?.opticalHealth === 'CRITICAL'
              ? `Sinal óptico crítico: RX em ${num(latest.rxPower)} dBm. Provável atenuação na fibra/conector.`
              : (d.openAlerts.find((a) => a.severity === 'CRITICAL')?.message ?? 'Alerta crítico aberto.')}
          </span>
        </div>
      )}
      {isStale && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
          <span>Dados coletados há mais de 5 minutos — podem estar desatualizados.</span>
          <Button variant="secondary" size="sm" loading={busy} onClick={handleRefresh}>
            <RefreshCw className="mr-1 h-4 w-4" /> Atualizar
          </Button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200 dark:border-slate-800">
        {TABS.map((tb) => (
          <button
            key={tb.key}
            onClick={() => setTab(tb.key)}
            className={`border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              tab === tb.key
                ? 'border-sky-500 text-sky-600 dark:text-sky-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            {tb.label}
          </button>
        ))}
      </div>

      {/* ───────── Visão geral ───────── */}
      {tab === 'geral' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Metric label="Uptime WAN" value={uptime(latest?.wanUptime)} big />
            <Metric
              label="PPPoE"
              value={latest?.pppStatus ?? '—'}
              tone={latest?.pppStatus === 'Connected' ? 'success' : latest?.pppStatus ? 'danger' : 'neutral'}
              big
            />
            <Metric label="Temperatura" value={fmt(latest?.temperature, '°C')} big />
            <Metric label="Tensão" value={fmt(latest?.voltage, 'V')} big />
          </div>

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
                  {d.ont && <Info label={t('detail.snGpon')} value={d.ont.snGpon} mono />}
                  {latest?.hostsCount != null && (
                    <Info label={t('detail.hostsCount')} value={String(latest.hostsCount)} />
                  )}
                </dl>
              </CardContent>
            </Card>

            {compliance && (
              <Card>
                <CardHeader className="flex-row items-center justify-between">
                  <CardTitle>Conformidade</CardTitle>
                  <span
                    className={`rounded px-2 py-0.5 text-xs ${(COMPLIANCE_META[compliance.complianceStatus] ?? COMPLIANCE_META.UNKNOWN).cls}`}
                  >
                    {(COMPLIANCE_META[compliance.complianceStatus] ?? COMPLIANCE_META.UNKNOWN).label}
                  </span>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-slate-500">
                    Profile:{' '}
                    <span className="text-slate-900 dark:text-slate-100">
                      {compliance.profileName ?? '— (nenhum profile casou)'}
                    </span>
                  </p>
                  {compliance.drifts.filter((dr) => dr.status !== 'RESOLVED').length === 0 ? (
                    <p className="text-sm text-slate-500">Sem divergências em aberto.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead className="text-left text-slate-500">
                          <tr>
                            <th className="py-1 pr-2 font-medium">Parâmetro</th>
                            <th className="py-1 pr-2 font-medium">Esperado</th>
                            <th className="py-1 pr-2 font-medium">Atual</th>
                            <th className="py-1 pr-2 font-medium">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                          {compliance.drifts
                            .filter((dr) => dr.status !== 'RESOLVED')
                            .map((dr) => (
                              <tr key={dr.id}>
                                <td className="py-1 pr-2 font-mono">{shortParam(dr.param)}</td>
                                <td className="py-1 pr-2 font-mono text-emerald-600 dark:text-emerald-400">
                                  {dr.expected ?? '—'}
                                </td>
                                <td className="py-1 pr-2 font-mono text-red-600 dark:text-red-400">
                                  {dr.actual ?? '—'}
                                </td>
                                <td className="py-1 pr-2">
                                  {DRIFT_LABEL[dr.status]}
                                  {dr.requiresReboot ? ' · reboot' : ''}
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}

      {/* ───────── Diagnóstico ───────── */}
      {tab === 'diag' && (
        <div className="space-y-4">
          {!latest ? (
            <DiagEmpty t={t} lastDiagTask={lastDiagTask} />
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader className="flex-row items-center justify-between">
                  <CardTitle>{t('detail.sectionOptical')}</CardTitle>
                  <Badge tone={HEALTH_TONE[latest.opticalHealth]}>
                    {t(`detail.health.${latest.opticalHealth}` as 'detail.health.OK')}
                  </Badge>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Gauge
                        value={latest.rxPower ?? -30}
                        min={-30}
                        max={-8}
                        color={(latest.rxPower ?? -30) < -25 ? TR069_COLORS.crit : TR069_COLORS.ok}
                        display={num(latest.rxPower)}
                      />
                      <p className="text-center text-xs text-slate-500">{t('detail.rxPower')} (dBm)</p>
                    </div>
                    <div>
                      <Gauge
                        value={latest.txPower ?? 0}
                        min={0}
                        max={5}
                        color={TR069_COLORS.blue}
                        display={num(latest.txPower)}
                      />
                      <p className="text-center text-xs text-slate-500">{t('detail.txPower')} (dBm)</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4 border-t border-slate-100 pt-3 dark:border-slate-800 sm:grid-cols-4">
                    <Metric label="FEC" value={fmt(latest.fecErrors, '')} />
                    <Metric label="HEC" value={fmt(latest.hecErrors, '')} />
                    <Metric label={t('detail.temperature')} value={fmt(latest.temperature, '°C')} />
                    <Metric label={t('detail.bias')} value={fmt(latest.biasCurrent, 'mA')} />
                  </div>
                </CardContent>
              </Card>

              {/* RX power histórico (painel escuro + line chart) */}
              <div className="rounded-xl border border-slate-800 bg-[#0e1726] p-4">
                <p className="mb-2 text-xs text-slate-400">{t('detail.rxTrend')}</p>
                {rxPoints.length >= 2 ? (
                  <LineChart series={[{ data: rxPoints, color: TR069_COLORS.crit }]} height={140} />
                ) : (
                  <p className="text-sm text-slate-500">Série insuficiente.</p>
                )}
              </div>

              {/* Conexão WAN */}
              <Card>
                <CardHeader>
                  <CardTitle>Conexão WAN</CardTitle>
                </CardHeader>
                <CardContent>
                  <dl className="grid grid-cols-2 gap-y-2 text-sm">
                    <Info label="Estado PPPoE" value={latest.pppStatus} />
                    <Info label="Uptime" value={uptime(latest.wanUptime)} />
                    <Info label="Último erro" value={latest.pppLastError} />
                    <Info label="GPON" value={latest.gponStatus} />
                  </dl>
                </CardContent>
              </Card>

              {/* Diagnósticos sob demanda (TR-143) */}
              <Card>
                <CardHeader className="flex-row items-center justify-between">
                  <CardTitle>Ping / Speed test</CardTitle>
                  <div className="flex gap-2">
                    <Button variant="secondary" size="sm" loading={busy} onClick={handlePing}>
                      <Network className="mr-1 h-4 w-4" /> {t('detail.ping')}
                    </Button>
                    <Button variant="secondary" size="sm" loading={busy} onClick={handleSpeedTest}>
                      <GaugeIcon className="mr-1 h-4 w-4" /> {t('detail.speedTest')}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {!runs || runs.length === 0 ? (
                    <p className="text-sm text-slate-500">Nenhum teste executado.</p>
                  ) : (
                    <div className="space-y-1.5 font-mono text-xs">
                      {runs.slice(0, 6).map((r) => (
                        <div key={r.id} className="flex items-center justify-between gap-2">
                          <span className="text-slate-600 dark:text-slate-300">
                            {r.kind === 'PING' ? `Ping ${r.target ?? ''}` : r.kind === 'UPLOAD' ? 'Upload' : 'Download'}
                          </span>
                          <span className={r.state === 'ERROR' ? 'text-red-500' : 'text-slate-500'}>
                            {r.state === 'ERROR'
                              ? (r.errorText ?? 'erro')
                              : r.kind === 'PING'
                                ? r.pingAvgMs !== null
                                  ? `${r.pingAvgMs} ms · ${r.pingSuccess ?? 0}/${(r.pingSuccess ?? 0) + (r.pingFailure ?? 0)} ok`
                                  : '…'
                                : r.throughputKbps !== null
                                  ? `${(r.throughputKbps / 1000).toFixed(1)} Mbps`
                                  : '…'}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      )}

      {/* ───────── WiFi ───────── */}
      {tab === 'wifi' && (
        <div className="space-y-4">
          {!latest ? (
            <DiagEmpty t={t} lastDiagTask={lastDiagTask} />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
                <Metric label={t('detail.clients24')} value={fmt(latest.wifiClients24, '')} big />
                <Metric label={t('detail.clients5')} value={fmt(latest.wifiClients5, '')} big />
                <Metric label={`${t('detail.channel')} 2.4G`} value={num(latest.wifiChannel24)} />
                <Metric label={`${t('detail.channel')} 5G`} value={num(latest.wifiChannel5)} />
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
              </div>
              <Card>
                <CardHeader>
                  <CardTitle>{t('detail.connectedDevices')}</CardTitle>
                </CardHeader>
                <CardContent>
                  {latest.wifiClients.length === 0 ? (
                    <p className="text-sm text-slate-500">{t('detail.noClients')}</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead className="text-left text-slate-500">
                          <tr>
                            <th className="py-1 pr-2 font-medium">{t('detail.colMac')}</th>
                            <th className="py-1 pr-2 font-medium">{t('detail.colBand')}</th>
                            <th className="py-1 pr-2 font-medium">RSSI</th>
                            <th className="py-1 pr-2 font-medium">{t('detail.colRate')}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                          {latest.wifiClients.map((c, i) => (
                            <tr key={c.mac ?? i}>
                              <td className="py-1 pr-2 font-mono">{c.mac ?? '—'}</td>
                              <td className="py-1 pr-2">{c.band}</td>
                              <td className="py-1 pr-2">
                                <span className="flex items-center gap-2">
                                  <RssiBars rssi={c.rssi} />
                                  <span className={`font-medium ${rssiClass(c.rssi)}`}>
                                    {c.rssi === null ? '—' : `${c.rssi} dBm`}
                                  </span>
                                </span>
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
                </CardContent>
              </Card>
            </>
          )}
        </div>
      )}

      {/* ───────── Histórico ───────── */}
      {tab === 'hist' && (
        <div className="space-y-4">
          {d.openAlerts.length > 0 && (
            <div className="space-y-2">
              {d.openAlerts.map((a) => (
                <div
                  key={a.id}
                  className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200"
                >
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  <div className="flex-1">
                    <Badge tone={SEVERITY_TONE[a.severity]}>{a.severity}</Badge>
                    <span className="ml-2">{a.message}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

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

          {/* Visor de todos os atributos TR-069 */}
          <Card>
            <CardHeader className="flex-row items-center justify-between gap-3">
              <CardTitle>Atributos TR-069 ({paramList.length})</CardTitle>
              <input
                value={paramSearch}
                onChange={(e) => {
                  setParamSearch(e.target.value);
                  setParamPage(0);
                }}
                placeholder="Buscar parâmetro…"
                className="w-64 rounded-md border border-slate-200 bg-transparent px-2 py-1 text-sm dark:border-slate-700"
              />
            </CardHeader>
            <CardContent>
              {paramList.length === 0 ? (
                <p className="text-sm text-slate-500">
                  {deviceParams ? 'Nenhum atributo no último snapshot.' : 'Carregando…'}
                </p>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="text-left text-slate-500">
                        <tr>
                          <th className="py-1 pr-2 font-medium">Atributo</th>
                          <th className="py-1 pr-2 font-medium">Valor</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {paramSlice.map((p) => (
                          <tr key={p.name}>
                            <td className="break-all py-1 pr-2 font-mono">{p.name}</td>
                            <td className="break-all py-1 pr-2 font-mono">{p.value || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {paramPages > 1 && (
                    <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                      <span>
                        Página {paramPage + 1} de {paramPages}
                      </span>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={paramPage === 0}
                          onClick={() => setParamPage((p) => Math.max(0, p - 1))}
                        >
                          Anterior
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={paramPage >= paramPages - 1}
                          onClick={() => setParamPage((p) => Math.min(paramPages - 1, p + 1))}
                        >
                          Próxima
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}
      {/* Modais de ação */}
      <Modal
        open={modal === 'reboot'}
        onClose={() => setModal(null)}
        title="Reiniciar CPE"
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setModal(null)}>
              Cancelar
            </Button>
            <Button variant="primary" size="sm" loading={busy} onClick={handleReboot}>
              Reiniciar
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          O CPE vai reiniciar e ficar ~1–2 min offline. O comando é aplicado no próximo Inform.
        </p>
      </Modal>

      <Modal
        open={modal === 'firmware'}
        onClose={() => setModal(null)}
        title="Atualizar firmware"
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setModal(null)}>
              Cancelar
            </Button>
            <Button variant="primary" size="sm" loading={busy} onClick={handleFirmware}>
              Enviar
            </Button>
          </>
        }
      >
        <label className="block text-sm">
          <span className="text-slate-500">URL da imagem (HTTP/HTTPS)</span>
          <input
            value={fwUrl}
            onChange={(e) => setFwUrl(e.target.value)}
            placeholder="https://…/firmware.bin"
            className="mt-1 w-full rounded-md border border-slate-200 bg-transparent px-3 py-1.5 text-sm dark:border-slate-700"
          />
        </label>
      </Modal>

      <Modal
        open={modal === 'reprovision'}
        onClose={() => setModal(null)}
        title="Reprovisionar"
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setModal(null)}>
              Cancelar
            </Button>
            <Button variant="primary" size="sm" loading={busy} onClick={handleReprovision}>
              Reprovisionar
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Reaplica RADIUS + Wi-Fi/PPPoE do contrato no CPE. Útil quando o cliente não subiu.
        </p>
      </Modal>
    </div>
  );
}

function DiagEmpty({
  t,
  lastDiagTask,
}: {
  t: ReturnType<typeof useTranslations>;
  lastDiagTask?: { status: string; error: string | null };
}) {
  return (
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
      ) : (
        <p className="text-slate-500 dark:text-slate-400">{t('detail.noDiagnostic')}</p>
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
    <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
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
