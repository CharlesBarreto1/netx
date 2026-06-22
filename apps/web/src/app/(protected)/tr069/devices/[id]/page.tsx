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
  Plus,
  RefreshCw,
  RotateCcw,
  Router,
  Search,
  ShieldCheck,
  StickyNote,
  Trash2,
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
import {
  BarHeatmap,
  Gauge,
  LineChart,
  MiniBars,
  RssiBars,
  StatusGrid,
  TR069_COLORS,
} from '@/components/tr069/Charts';
import { notify } from '@/lib/notify';
import {
  COMPLIANCE_META,
  provisioningApi,
  tr069Api,
  TR069_WIFI_CHANNELS,
  TR069_WIFI_TX_POWER_LEVELS,
  TR069_WIFI_WIDTHS,
  TR069_ROUTER_TZ_OFFSETS,
  type Tr069AlertSeverity,
  type Tr069DeviceNoteDto,
  type Tr069DiagnosticDto,
  type Tr069ProbeResultDto,
  type Tr069DriftStatus,
  type Tr069OpticalHealth,
  type Tr069WifiBand,
  type SetWifiRadioBody,
  type SetRouterSettingsBody,
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
  const [wifiEdit, setWifiEdit] = useState<Tr069WifiBand | null>(null);
  const [routerOpen, setRouterOpen] = useState(false);
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
  const { data: deviceHistory } = useSWR(
    id && tab === 'hist' ? `tr069/devices/${id}/history` : null,
    () => tr069Api.deviceHistory(id),
    { refreshInterval: 60_000 },
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

  // Throughput WAN: delta de bytes ÷ delta de tempo entre pontos da série (Mbps).
  const chrono = (history ?? []).slice().reverse(); // antigo → novo
  const downPts: number[] = [];
  const upPts: number[] = [];
  for (let i = 1; i < chrono.length; i++) {
    const a = chrono[i - 1];
    const b = chrono[i];
    if (a.wanRxBytes == null || b.wanRxBytes == null || a.wanTxBytes == null || b.wanTxBytes == null) {
      continue;
    }
    const dt = (new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime()) / 1000;
    if (dt <= 0) continue;
    const dRx = b.wanRxBytes - a.wanRxBytes;
    const dTx = b.wanTxBytes - a.wanTxBytes;
    if (dRx < 0 || dTx < 0) continue; // contador zerou/estourou — pula o intervalo
    downPts.push(Math.round(((dRx * 8) / dt / 1e6) * 10) / 10);
    upPts.push(Math.round(((dTx * 8) / dt / 1e6) * 10) / 10);
  }
  const lastDown = downPts.length ? downPts[downPts.length - 1] : null;
  const lastUp = upPts.length ? upPts[upPts.length - 1] : null;
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
              {d.ont?.macAddress && (
                <>
                  <span>·</span>
                  <span>MAC {d.ont.macAddress}</span>
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
            <Button variant="outline" size="sm" onClick={() => setRouterOpen(true)}>
              <Router className="mr-1 h-4 w-4" /> Roteador
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

          <Card>
            <CardHeader>
              <CardTitle>Recursos do CPE</CardTitle>
            </CardHeader>
            <CardContent>
              {latest && (latest.cpuUsage !== null || latest.memUsage !== null || latest.deviceTemp !== null) ? (
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <Gauge
                      value={latest.cpuUsage ?? 0}
                      min={0}
                      max={100}
                      color={(latest.cpuUsage ?? 0) > 80 ? TR069_COLORS.crit : TR069_COLORS.blue}
                      display={latest.cpuUsage === null ? '—' : `${latest.cpuUsage}%`}
                    />
                    <p className="text-center text-xs text-slate-500">CPU</p>
                  </div>
                  <div>
                    <Gauge
                      value={latest.memUsage ?? 0}
                      min={0}
                      max={100}
                      color={(latest.memUsage ?? 0) > 85 ? TR069_COLORS.crit : TR069_COLORS.blue}
                      display={latest.memUsage === null ? '—' : `${latest.memUsage}%`}
                    />
                    <p className="text-center text-xs text-slate-500">Memória</p>
                  </div>
                  <div>
                    <Gauge
                      value={latest.deviceTemp ?? 0}
                      min={0}
                      max={90}
                      color={(latest.deviceTemp ?? 0) > 65 ? TR069_COLORS.crit : TR069_COLORS.ok}
                      display={latest.deviceTemp === null ? '—' : `${latest.deviceTemp}°`}
                    />
                    <p className="text-center text-xs text-slate-500">Temp</p>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-slate-500">Sem coleta de recursos ainda.</p>
              )}
            </CardContent>
          </Card>

          {/* Throughput WAN (painel escuro + line chart down/up) */}
          <div className="rounded-xl border border-slate-800 bg-[#0e1726] p-4">
            <div className="mb-2 flex items-center justify-between gap-3 text-xs">
              <span className="text-slate-400">Throughput WAN (Mbps)</span>
              <span className="flex gap-3 font-mono">
                <span style={{ color: TR069_COLORS.blueChart }}>
                  ↓ {lastDown === null ? '—' : lastDown}
                </span>
                <span style={{ color: TR069_COLORS.ok }}>↑ {lastUp === null ? '—' : lastUp}</span>
              </span>
            </div>
            {downPts.length >= 2 ? (
              <LineChart
                series={[
                  { data: downPts, color: TR069_COLORS.blueChart },
                  { data: upPts, color: TR069_COLORS.ok, fill: false },
                ]}
                height={140}
              />
            ) : (
              <p className="text-sm text-slate-500">
                Série insuficiente — a vazão aparece após 2+ coletas com contadores de bytes.
              </p>
            )}
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

            <NotesCard deviceId={id} />
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
              <div className="grid gap-4 sm:grid-cols-2">
                <RadioCard
                  band="2.4G"
                  channel={latest.wifiChannel24}
                  clients={latest.wifiClients24}
                  onEdit={() => setWifiEdit('2.4G')}
                />
                <RadioCard
                  band="5G"
                  channel={latest.wifiChannel5}
                  clients={latest.wifiClients5}
                  onEdit={() => setWifiEdit('5G')}
                />
              </div>
              <ChannelScanCard deviceId={id} currentChannel={latest.wifiChannel24} />
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
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Reboots &amp; quedas · 14 dias</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <MiniBars
                  data={(deviceHistory?.daily ?? []).map((dd) => dd.reboots + dd.outages)}
                  color={TR069_COLORS.purple}
                />
                <div className="flex gap-4 text-xs text-slate-500">
                  <span>
                    Reboots:{' '}
                    <span className="font-medium text-slate-900 dark:text-slate-100">
                      {(deviceHistory?.daily ?? []).reduce((s, dd) => s + dd.reboots, 0)}
                    </span>
                  </span>
                  <span>
                    Quedas:{' '}
                    <span className="font-medium text-slate-900 dark:text-slate-100">
                      {(deviceHistory?.daily ?? []).reduce((s, dd) => s + dd.outages, 0)}
                    </span>
                  </span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle>Disponibilidade · 30 dias</CardTitle>
                <span className="font-mono text-lg font-semibold text-emerald-600 dark:text-emerald-400">
                  {deviceHistory ? `${deviceHistory.availabilityPct}%` : '—'}
                </span>
              </CardHeader>
              <CardContent>
                {deviceHistory && deviceHistory.availability.length > 0 ? (
                  <StatusGrid days={deviceHistory.availability} />
                ) : (
                  <p className="text-sm text-slate-500">Sem dados de disponibilidade.</p>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Linha do tempo de eventos</CardTitle>
            </CardHeader>
            <CardContent>
              {!deviceHistory || deviceHistory.timeline.length === 0 ? (
                <p className="text-sm text-slate-500">Nenhum evento recente.</p>
              ) : (
                <ul className="space-y-3">
                  {deviceHistory.timeline.map((ev, i) => (
                    <li key={i} className="flex gap-3">
                      <span
                        className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                        style={{
                          background:
                            ev.severity === 'crit'
                              ? TR069_COLORS.crit
                              : ev.severity === 'warn'
                                ? TR069_COLORS.warn
                                : ev.severity === 'ok'
                                  ? TR069_COLORS.ok
                                  : TR069_COLORS.blueChart,
                        }}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{ev.title}</p>
                        {ev.description && (
                          <p className="break-words text-xs text-slate-500">{ev.description}</p>
                        )}
                      </div>
                      <span className="shrink-0 font-mono text-xs text-slate-400">
                        {new Date(ev.at).toLocaleString('pt-BR')}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

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

          <ProbeCard deviceId={id} />
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

      {routerOpen && (
        <RouterSettingsModal
          deviceId={id}
          onClose={() => setRouterOpen(false)}
          onSaved={() => {
            setRouterOpen(false);
            void mutate();
          }}
        />
      )}

      {wifiEdit && (
        <WifiEditModal
          deviceId={id}
          band={wifiEdit}
          currentChannel={wifiEdit === '2.4G' ? latest?.wifiChannel24 ?? null : latest?.wifiChannel5 ?? null}
          onClose={() => setWifiEdit(null)}
          onSaved={() => {
            setWifiEdit(null);
            void mutate();
          }}
        />
      )}

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

function ChannelScanCard({
  deviceId,
  currentChannel,
}: {
  deviceId: string;
  currentChannel: number | null;
}) {
  const { data, mutate } = useSWR(
    `tr069/devices/${deviceId}/wifi-scan`,
    () => tr069Api.wifiScan(deviceId),
    { refreshInterval: (d) => (d?.pending ? 5000 : 0) },
  );
  const [busy, setBusy] = useState(false);

  const scan = async () => {
    setBusy(true);
    try {
      const res = await tr069Api.requestWifiScan(deviceId);
      notify.success('Scan disparado', { description: res.message });
      await mutate();
    } catch (e) {
      notify.apiError(e);
    } finally {
      setBusy(false);
    }
  };

  const channels24 = data?.channels24 ?? [];
  const bars = channels24.map((c) => ({
    label: String(c.channel),
    value: c.count,
    active: c.channel === currentChannel,
  }));
  // Sugestão: entre os canais não sobrepostos (1/6/11), o menos ocupado.
  const suggestion = [1, 6, 11]
    .map((ch) => ({ ch, count: channels24.find((c) => c.channel === ch)?.count ?? 0 }))
    .sort((a, b) => a.count - b.count)[0];
  const hasData = channels24.some((c) => c.count > 0);

  return (
    <div className="rounded-xl border border-slate-800 bg-[#0e1726] p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-xs text-slate-400">
          Ocupação de canais 2.4 GHz
          {data?.neighbors.length ? ` · ${data.neighbors.length} redes` : ''}
        </p>
        <Button variant="secondary" size="sm" loading={busy} onClick={scan}>
          <Search className="mr-1 h-4 w-4" /> Escanear
        </Button>
      </div>
      {hasData ? (
        <>
          <BarHeatmap bars={bars} />
          {suggestion && currentChannel !== null && suggestion.ch !== currentChannel && (
            <p className="mt-3 text-xs text-amber-300">
              Canal atual {currentChannel}. Sugestão: migrar para o canal {suggestion.ch} (menos
              congestionado).
            </p>
          )}
        </>
      ) : (
        <p className="text-sm text-slate-500">
          {data?.pending
            ? 'Escaneando… o resultado chega no próximo Inform.'
            : 'Sem dados de vizinhança. Clique em Escanear.'}
        </p>
      )}
    </div>
  );
}

function RadioCard({
  band,
  channel,
  clients,
  onEdit,
}: {
  band: Tr069WifiBand;
  channel: number | null;
  clients: number | null;
  onEdit: () => void;
}) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-3 pt-6">
        <div>
          <p className="text-sm font-semibold">Rádio {band}</p>
          <p className="mt-0.5 font-mono text-xs text-slate-500">
            Canal {channel ?? '—'} · {clients ?? 0} cliente(s)
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onEdit}>
          Editar
        </Button>
      </CardContent>
    </Card>
  );
}

/** Valor especial do select = "não alterar este campo". */
const KEEP = '__keep__';

function RouterSettingsModal({
  deviceId,
  onClose,
  onSaved,
}: {
  deviceId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [steeringSel, setSteeringSel] = useState<string>(KEEP);
  const [ntpSel, setNtpSel] = useState<string>(KEEP);
  const [tzSel, setTzSel] = useState<string>(KEEP);
  const [ntpServer, setNtpServer] = useState('');
  const [busy, setBusy] = useState(false);

  const dirty =
    steeringSel !== KEEP || ntpSel !== KEEP || tzSel !== KEEP || ntpServer.trim() !== '';

  const save = async () => {
    const body: SetRouterSettingsBody = {};
    if (steeringSel !== KEEP) body.bandSteering = steeringSel === 'on';
    if (ntpSel !== KEEP) body.timeEnable = ntpSel === 'on';
    if (tzSel !== KEEP) body.timeZoneOffset = tzSel;
    if (ntpServer.trim()) body.ntpServer = ntpServer.trim();
    setBusy(true);
    try {
      const res = await tr069Api.setRouter(deviceId, body);
      notify.success('Roteador enfileirado', { description: res.message });
      onSaved();
    } catch (e) {
      notify.apiError(e);
    } finally {
      setBusy(false);
    }
  };

  const selCls =
    'mt-1 w-full rounded-md border border-slate-200 bg-transparent px-2 py-1.5 text-sm dark:border-slate-700';

  return (
    <Modal
      open
      onClose={onClose}
      title="Configurações do roteador"
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" size="sm" loading={busy} disabled={!dirty} onClick={save}>
            Aplicar
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-800/50">
          UPnP e EasyMesh não são expostos por este firmware via TR-069. Aplica no próximo Inform.
        </p>

        <label className="block text-sm">
          <span className="text-slate-500">Band steering (2.4G/5G unificado)</span>
          <select className={selCls} value={steeringSel} onChange={(e) => setSteeringSel(e.target.value)}>
            <option value={KEEP}>Manter</option>
            <option value="on">Ligado</option>
            <option value="off">Desligado</option>
          </select>
        </label>

        <label className="block text-sm">
          <span className="text-slate-500">Cliente de horário (NTP)</span>
          <select className={selCls} value={ntpSel} onChange={(e) => setNtpSel(e.target.value)}>
            <option value={KEEP}>Manter</option>
            <option value="on">Ligado</option>
            <option value="off">Desligado</option>
          </select>
        </label>

        <label className="block text-sm">
          <span className="text-slate-500">Fuso horário</span>
          <select className={selCls} value={tzSel} onChange={(e) => setTzSel(e.target.value)}>
            <option value={KEEP}>Manter</option>
            {TR069_ROUTER_TZ_OFFSETS.map((o) => (
              <option key={o} value={o}>
                UTC{o}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          <span className="text-slate-500">Servidor NTP (opcional)</span>
          <input
            value={ntpServer}
            onChange={(e) => setNtpServer(e.target.value)}
            placeholder="ex.: a.st1.ntp.br"
            className={selCls}
          />
        </label>
      </div>
    </Modal>
  );
}

function WifiEditModal({
  deviceId,
  band,
  currentChannel,
  onClose,
  onSaved,
}: {
  deviceId: string;
  band: Tr069WifiBand;
  currentChannel: number | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  // channelSel: KEEP | 'auto' | número(string)
  const [channelSel, setChannelSel] = useState<string>(KEEP);
  const [widthSel, setWidthSel] = useState<string>(KEEP);
  const [powerSel, setPowerSel] = useState<string>(KEEP);
  const [securitySel, setSecuritySel] = useState<string>(KEEP);
  const [busy, setBusy] = useState(false);

  const dirty =
    channelSel !== KEEP || widthSel !== KEEP || powerSel !== KEEP || securitySel !== KEEP;

  const save = async () => {
    const body: SetWifiRadioBody = { band };
    if (channelSel === 'auto') body.autoChannel = true;
    else if (channelSel !== KEEP) {
      body.autoChannel = false;
      body.channel = Number(channelSel);
    }
    if (widthSel !== KEEP) body.channelWidth = widthSel as SetWifiRadioBody['channelWidth'];
    if (powerSel !== KEEP) body.txPower = Number(powerSel);
    if (securitySel !== KEEP) body.security = securitySel as SetWifiRadioBody['security'];
    setBusy(true);
    try {
      const res = await tr069Api.setWifi(deviceId, body);
      notify.success('Wi-Fi enfileirado', { description: res.message });
      onSaved();
    } catch (e) {
      notify.apiError(e);
    } finally {
      setBusy(false);
    }
  };

  const selCls =
    'mt-1 w-full rounded-md border border-slate-200 bg-transparent px-2 py-1.5 text-sm dark:border-slate-700';

  return (
    <Modal
      open
      onClose={onClose}
      title={`Editar Wi-Fi · ${band}`}
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" size="sm" loading={busy} disabled={!dirty} onClick={save}>
            Aplicar
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-800/50">
          SSID e senha vêm do contrato — aqui só canal, potência e criptografia. Aplica no próximo
          Inform do CPE.
        </p>

        <label className="block text-sm">
          <span className="text-slate-500">Canal (atual: {currentChannel ?? '—'})</span>
          <select className={selCls} value={channelSel} onChange={(e) => setChannelSel(e.target.value)}>
            <option value={KEEP}>Manter</option>
            <option value="auto">Automático</option>
            {TR069_WIFI_CHANNELS[band].map((c) => (
              <option key={c} value={String(c)}>
                Canal {c}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          <span className="text-slate-500">Largura de banda</span>
          <select className={selCls} value={widthSel} onChange={(e) => setWidthSel(e.target.value)}>
            <option value={KEEP}>Manter</option>
            {TR069_WIFI_WIDTHS[band].map((wd) => (
              <option key={wd} value={wd}>
                {wd === 'auto' ? 'Automática' : `${wd} MHz`}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          <span className="text-slate-500">Potência</span>
          <select className={selCls} value={powerSel} onChange={(e) => setPowerSel(e.target.value)}>
            <option value={KEEP}>Manter</option>
            {TR069_WIFI_TX_POWER_LEVELS.map((p) => (
              <option key={p} value={String(p)}>
                {p}%
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          <span className="text-slate-500">Criptografia</span>
          <select
            className={selCls}
            value={securitySel}
            onChange={(e) => setSecuritySel(e.target.value)}
          >
            <option value={KEEP}>Manter</option>
            <option value="WPA2">WPA2 (AES)</option>
            <option value="WPA_WPA2">WPA/WPA2 (TKIP+AES)</option>
          </select>
        </label>
      </div>
    </Modal>
  );
}

function ProbeCard({ deviceId }: { deviceId: string }) {
  const [path, setPath] = useState('InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.');
  const [taskId, setTaskId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');

  const { data: result } = useSWR(
    taskId ? `tr069/probe/${deviceId}/${taskId}` : null,
    () => tr069Api.probeResult(deviceId, taskId as string),
    {
      refreshInterval: (latest?: Tr069ProbeResultDto) =>
        latest && ['DONE', 'FAILED', 'CANCELLED'].includes(latest.status) ? 0 : 4000,
    },
  );

  const run = async () => {
    const name = path.trim();
    if (!name) return;
    setBusy(true);
    try {
      const res = await tr069Api.probe(deviceId, [name]);
      setTaskId(res.taskId);
      setSearch('');
      notify.success('Probe enfileirado', { description: res.message });
    } catch (e) {
      notify.apiError(e);
    } finally {
      setBusy(false);
    }
  };

  const rows = (result?.params ?? []).filter((p) =>
    `${p.name} ${p.value}`.toLowerCase().includes(search.toLowerCase()),
  );
  const pending = result && (result.status === 'PENDING' || result.status === 'RUNNING');

  return (
    <Card>
      <CardHeader className="flex-row items-center gap-2">
        <Search className="h-4 w-4 text-slate-400" />
        <CardTitle>Probe TR-069 (bancada)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
          Huawei dá fault no GET inteiro se um nome não existir. Prove{' '}
          <strong>um caminho parcial por vez</strong> (terminando em <code>.</code>) — o CPE devolve a
          subárvore. Aplica no próximo Inform (ou via acionamento, se alcançável).
        </p>
        <div className="flex items-start gap-2">
          <input
            value={path}
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void run();
            }}
            placeholder="InternetGatewayDevice.…"
            className="flex-1 rounded-md border border-slate-200 bg-transparent px-2 py-1.5 font-mono text-xs dark:border-slate-700"
          />
          <Button variant="primary" size="sm" loading={busy} onClick={run} disabled={!path.trim()}>
            Enfileirar
          </Button>
        </div>

        {result && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs">
              <Badge
                tone={
                  result.status === 'DONE'
                    ? 'success'
                    : result.status === 'FAILED'
                      ? 'danger'
                      : result.status === 'RUNNING'
                        ? 'info'
                        : 'neutral'
                }
              >
                {result.status}
              </Badge>
              <span className="font-mono text-slate-400">{result.names.join(', ')}</span>
            </div>
            {pending && (
              <p className="text-sm text-slate-500">
                Aguardando o CPE responder no próximo Inform…
              </p>
            )}
            {result.status === 'FAILED' && (
              <p className="font-mono text-xs text-red-600 dark:text-red-400">
                {result.error ?? 'fault'}
              </p>
            )}
            {result.status === 'DONE' && result.params && (
              <>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-slate-500">{result.params.length} parâmetro(s)</span>
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Filtrar…"
                    className="w-48 rounded-md border border-slate-200 bg-transparent px-2 py-1 text-xs dark:border-slate-700"
                  />
                </div>
                {rows.length === 0 ? (
                  <p className="text-sm text-slate-500">
                    {result.params.length === 0 ? 'Resposta vazia (caminho sem folhas?).' : 'Nada no filtro.'}
                  </p>
                ) : (
                  <div className="max-h-80 overflow-auto rounded-md border border-slate-100 dark:border-slate-800">
                    <table className="w-full text-xs">
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {rows.map((p) => (
                          <tr key={p.name}>
                            <td className="break-all py-1 pr-2 pl-2 font-mono">{p.name}</td>
                            <td className="break-all py-1 pr-2 font-mono text-slate-500">{p.value || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function NotesCard({ deviceId }: { deviceId: string }) {
  const { data: notes, mutate } = useSWR(
    deviceId ? `tr069/devices/${deviceId}/notes` : null,
    () => tr069Api.listNotes(deviceId),
  );
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  const add = async () => {
    const text = body.trim();
    if (!text) return;
    setBusy(true);
    try {
      await tr069Api.createNote(deviceId, text);
      setBody('');
      notify.success('Nota adicionada');
      await mutate();
    } catch (e) {
      notify.apiError(e);
    } finally {
      setBusy(false);
    }
  };
  const remove = async (noteId: string) => {
    try {
      await tr069Api.deleteNote(deviceId, noteId);
      await mutate();
    } catch (e) {
      notify.apiError(e);
    }
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center gap-2">
        <StickyNote className="h-4 w-4 text-slate-400" />
        <CardTitle>Notas {notes?.length ? `(${notes.length})` : ''}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-start gap-2">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void add();
            }}
            placeholder="Anotação do atendimento (Ctrl+Enter pra salvar)…"
            rows={2}
            className="flex-1 resize-y rounded-md border border-slate-200 bg-transparent px-2 py-1.5 text-sm dark:border-slate-700"
          />
          <Button variant="primary" size="sm" loading={busy} onClick={add} disabled={!body.trim()}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        {!notes || notes.length === 0 ? (
          <p className="text-sm text-slate-500">Nenhuma nota.</p>
        ) : (
          <ul className="space-y-2">
            {notes.map((n: Tr069DeviceNoteDto) => (
              <li
                key={n.id}
                className="group rounded-md border border-slate-100 bg-slate-50 p-2 text-sm dark:border-slate-800 dark:bg-slate-900"
              >
                <p className="whitespace-pre-wrap break-words">{n.body}</p>
                <div className="mt-1 flex items-center justify-between gap-2 text-xs text-slate-400">
                  <span>
                    {n.createdByEmail ?? 'sistema'} · {new Date(n.createdAt).toLocaleString('pt-BR')}
                  </span>
                  <button
                    onClick={() => remove(n.id)}
                    className="opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100"
                    title="Remover nota"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
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
