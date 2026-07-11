'use client';

/**
 * /tr069/wifi-opt — rollout em ondas do pacote de otimização Wi-Fi Huawei.
 *
 * Painel do operador: cria a onda (name + textarea de deviceIds — v1), inicia/
 * cancela com confirmação e acompanha o progresso por estado. O motor
 * (wifi-opt-rollout.service) roda por minuto no core: baseline → push na
 * janela da madrugada → verificação → rollback automático → gate da onda.
 * O gateReport aparece quando todos os devices chegam a estado terminal.
 *
 * Flags: exige WIFI_OPT_ROLLOUT_ENABLED=1 no servidor + toggle do tenant em
 * /settings/tr069 — sem elas a onda fica parada em RUNNING sem push.
 */
import { Wifi } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import useSWR from 'swr';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { FieldHelp, Input, Label, Textarea } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api';
import {
  wifiOptApi,
  type WifiOptGateReport,
  type WifiOptWaveDeviceState,
  type WifiOptWaveStatus,
  type WifiOptWaveSummary,
} from '@/lib/provisioning-api';

/** Tom do badge por status da onda. */
const WAVE_STATUS_TONE: Record<WifiOptWaveStatus, 'neutral' | 'info' | 'success' | 'danger' | 'warning'> = {
  DRAFT: 'neutral',
  RUNNING: 'info',
  GATE_PASSED: 'success',
  GATE_FAILED: 'danger',
  CANCELLED: 'warning',
};

/** Tom do badge por estado do device (ordem = funil da state machine). */
const DEVICE_STATE_TONE: Record<WifiOptWaveDeviceState, 'neutral' | 'info' | 'brand' | 'warning' | 'success' | 'purple' | 'danger'> = {
  QUEUED: 'neutral',
  BASELINED: 'info',
  PUSHED: 'brand',
  VERIFYING: 'warning',
  APPLIED: 'success',
  ROLLED_BACK: 'purple',
  SKIPPED: 'neutral',
  FAILED: 'danger',
};

/** Ordem de exibição do progresso (funil, terminais no fim). */
const STATE_ORDER: WifiOptWaveDeviceState[] = [
  'QUEUED',
  'BASELINED',
  'PUSHED',
  'VERIFYING',
  'APPLIED',
  'ROLLED_BACK',
  'SKIPPED',
  'FAILED',
];

function msgOf(err: unknown): string {
  return err instanceof ApiError ? err.friendlyMessage : (err as Error).message;
}

export default function Tr069WifiOptPage() {
  const t = useTranslations('tr069WifiOpt');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: waves, isLoading, error, mutate } = useSWR(
    wifiOptApi.wavesPath(),
    () => wifiOptApi.listWaves(),
    { refreshInterval: 15_000, keepPreviousData: true },
  );

  return (
    <div className="space-y-5">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Wifi className="h-6 w-6 text-sky-500" /> {t('title')}
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">{t('subtitle')}</p>
      </header>

      <CreateWaveForm onCreated={() => void mutate()} />

      {isLoading && !waves ? (
        <PageLoader />
      ) : error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {t('waves.loadError')}
        </div>
      ) : !waves || waves.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-10 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
          {t('waves.empty')}
        </div>
      ) : (
        <WavesTable
          waves={waves}
          selectedId={selectedId}
          onSelect={(id) => setSelectedId((cur) => (cur === id ? null : id))}
          onChanged={() => void mutate()}
        />
      )}

      {selectedId && <WaveDetail waveId={selectedId} onChanged={() => void mutate()} />}
    </div>
  );
}

// =============================================================================
// Criação de onda — v1: name + textarea de deviceIds (um por linha)
// =============================================================================
function CreateWaveForm({ onCreated }: { onCreated: () => void }) {
  const t = useTranslations('tr069WifiOpt');
  const [name, setName] = useState('');
  const [deviceIdsText, setDeviceIdsText] = useState('');
  const [creating, setCreating] = useState(false);

  async function create() {
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error(t('create.nameRequired'));
      return;
    }
    // Um deviceId por linha; vírgula/;/espaço também separam (colagem de planilha).
    const deviceIds = deviceIdsText
      .split(/[\n,;\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (deviceIds.length === 0) {
      toast.error(t('create.deviceIdsRequired'));
      return;
    }
    setCreating(true);
    try {
      const r = await wifiOptApi.createWave({ name: trimmedName, deviceIds });
      toast.success(t('create.created', { count: r.deviceCount }));
      if (r.unknownDeviceIds.length > 0) {
        toast.warning(
          t('create.createdUnknown', {
            count: r.unknownDeviceIds.length,
            ids: r.unknownDeviceIds.slice(0, 5).join(', '),
          }),
        );
      }
      setName('');
      setDeviceIdsText('');
      onCreated();
    } catch (err) {
      toast.error(t('create.error', { error: msgOf(err) }));
    } finally {
      setCreating(false);
    }
  }

  return (
    <section className="rounded-lg border border-border bg-surface p-4 shadow-sm">
      <h2 className="mb-3 text-base font-semibold text-text">{t('create.title')}</h2>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <Label>{t('create.nameLabel')}</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('create.namePlaceholder')}
            maxLength={120}
          />
        </div>
        <div className="md:row-span-2">
          <Label>{t('create.deviceIdsLabel')}</Label>
          <Textarea
            value={deviceIdsText}
            onChange={(e) => setDeviceIdsText(e.target.value)}
            placeholder={t('create.deviceIdsPlaceholder')}
            rows={6}
            className="font-mono text-xs"
          />
          <FieldHelp>{t('create.deviceIdsHelp')}</FieldHelp>
        </div>
        <div className="flex items-end">
          <Button onClick={create} loading={creating}>
            {t('create.submit')}
          </Button>
        </div>
      </div>
    </section>
  );
}

// =============================================================================
// Lista de ondas — progresso por estado + start/cancel
// =============================================================================
function WavesTable({
  waves,
  selectedId,
  onSelect,
  onChanged,
}: {
  waves: WifiOptWaveSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onChanged: () => void;
}) {
  const t = useTranslations('tr069WifiOpt');
  const [busyId, setBusyId] = useState<string | null>(null);

  async function start(wave: WifiOptWaveSummary) {
    if (!window.confirm(t('waves.confirmStart', { name: wave.name }))) return;
    setBusyId(wave.id);
    try {
      await wifiOptApi.startWave(wave.id);
      toast.success(t('waves.started'));
      onChanged();
    } catch (err) {
      // Regra das 48h/última GATE_PASSED: oferece o `force` explícito ao
      // operador (a rota inteira já exige tr069.admin — sem escalação aqui).
      const message = msgOf(err);
      if (err instanceof ApiError && window.confirm(t('waves.confirmForce', { error: message }))) {
        try {
          await wifiOptApi.startWave(wave.id, true);
          toast.success(t('waves.started'));
          onChanged();
        } catch (err2) {
          toast.error(t('waves.startError', { error: msgOf(err2) }));
        }
      } else {
        toast.error(t('waves.startError', { error: message }));
      }
    } finally {
      setBusyId(null);
    }
  }

  async function cancel(wave: WifiOptWaveSummary) {
    if (!window.confirm(t('waves.confirmCancel', { name: wave.name }))) return;
    setBusyId(wave.id);
    try {
      await wifiOptApi.cancelWave(wave.id);
      toast.success(t('waves.cancelled'));
      onChanged();
    } catch (err) {
      toast.error(t('waves.cancelError', { error: msgOf(err) }));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 dark:bg-slate-900">
          <tr>
            <th className="px-3 py-2 text-left font-medium">{t('waves.colName')}</th>
            <th className="px-3 py-2 text-left font-medium">{t('waves.colStatus')}</th>
            <th className="px-3 py-2 text-left font-medium">{t('waves.colProgress')}</th>
            <th className="px-3 py-2 text-left font-medium">{t('waves.colCreated')}</th>
            <th className="px-3 py-2 text-left font-medium">{t('waves.colCompleted')}</th>
            <th className="px-3 py-2 text-right font-medium" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
          {waves.map((w) => (
            <tr
              key={w.id}
              onClick={() => onSelect(w.id)}
              className={`cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900/50 ${
                selectedId === w.id ? 'bg-slate-50 dark:bg-slate-900/50' : ''
              }`}
            >
              <td className="px-3 py-2 font-medium">{w.name}</td>
              <td className="px-3 py-2">
                <Badge tone={WAVE_STATUS_TONE[w.status]}>
                  {t(`statuses.${w.status}` as 'statuses.DRAFT')}
                </Badge>
              </td>
              <td className="px-3 py-2">
                <div className="flex flex-wrap gap-1">
                  {STATE_ORDER.filter((s) => (w.deviceCounts[s] ?? 0) > 0).map((s) => (
                    <Badge key={s} tone={DEVICE_STATE_TONE[s]}>
                      {t(`states.${s}` as 'states.QUEUED')} {w.deviceCounts[s]}
                    </Badge>
                  ))}
                  {w.gateReport && (
                    <Badge tone={w.gateReport.pass ? 'success' : 'danger'}>
                      {w.gateReport.pass ? t('gate.pass') : t('gate.fail')}
                    </Badge>
                  )}
                </div>
              </td>
              <td className="px-3 py-2 text-xs text-slate-500">
                {new Date(w.createdAt).toLocaleString('pt-BR')}
              </td>
              <td className="px-3 py-2 text-xs text-slate-500">
                {w.completedAt ? new Date(w.completedAt).toLocaleString('pt-BR') : '—'}
              </td>
              <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                <div className="flex justify-end gap-2">
                  {w.status === 'DRAFT' && (
                    <Button size="sm" onClick={() => start(w)} loading={busyId === w.id}>
                      {t('waves.start')}
                    </Button>
                  )}
                  {(w.status === 'DRAFT' || w.status === 'RUNNING') && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => cancel(w)}
                      loading={busyId === w.id}
                    >
                      {t('waves.cancel')}
                    </Button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// =============================================================================
// Detalhe da onda — devices/estados + gateReport + rollback manual
// =============================================================================
function WaveDetail({ waveId, onChanged }: { waveId: string; onChanged: () => void }) {
  const t = useTranslations('tr069WifiOpt');
  const [rollingBackId, setRollingBackId] = useState<string | null>(null);

  const { data: wave, error, mutate } = useSWR(
    `${wifiOptApi.wavesPath()}/${waveId}`,
    () => wifiOptApi.getWave(waveId),
    { refreshInterval: 15_000, keepPreviousData: true },
  );

  async function rollback(waveDeviceId: string, deviceId: string) {
    if (!window.confirm(t('detail.confirmRollback', { device: deviceId }))) return;
    setRollingBackId(waveDeviceId);
    try {
      await wifiOptApi.rollbackDevice(waveDeviceId);
      toast.success(t('detail.rolledBack', { device: deviceId }));
      void mutate();
      onChanged();
    } catch (err) {
      toast.error(t('detail.rollbackError', { error: msgOf(err) }));
    } finally {
      setRollingBackId(null);
    }
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
        {t('detail.loadError')}
      </div>
    );
  }
  if (!wave) return <PageLoader />;

  return (
    <section className="rounded-lg border border-border bg-surface p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-text">
          {t('detail.title')} — {wave.name}
        </h2>
        <Badge tone={WAVE_STATUS_TONE[wave.status]}>
          {t(`statuses.${wave.status}` as 'statuses.DRAFT')}
        </Badge>
      </div>

      {wave.gateReport && <GateReportCard report={wave.gateReport} />}

      {wave.devices.length === 0 ? (
        <p className="text-sm text-text-muted">{t('detail.empty')}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-hover text-text-muted">
              <tr>
                <th className="px-3 py-2 text-left font-medium">{t('detail.colDevice')}</th>
                <th className="px-3 py-2 text-left font-medium">{t('detail.colState')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('detail.colAttempts')}</th>
                <th className="px-3 py-2 text-left font-medium">{t('detail.colPushed')}</th>
                <th className="px-3 py-2 text-left font-medium">{t('detail.colError')}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {wave.devices.map((d) => (
                <tr key={d.id} className="border-t border-border">
                  <td className="px-3 py-2 font-mono text-xs">{d.deviceId}</td>
                  <td className="px-3 py-2">
                    <Badge tone={DEVICE_STATE_TONE[d.state]}>
                      {t(`states.${d.state}` as 'states.QUEUED')}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-right text-slate-500">{d.attempts}</td>
                  <td className="px-3 py-2 text-xs text-slate-500">
                    {d.pushedAt ? new Date(d.pushedAt).toLocaleString('pt-BR') : '—'}
                  </td>
                  <td className="max-w-xs truncate px-3 py-2 text-xs text-slate-500" title={d.error ?? undefined}>
                    {d.error ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {['PUSHED', 'VERIFYING', 'APPLIED'].includes(d.state) && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => rollback(d.id, d.deviceId)}
                        loading={rollingBackId === d.id}
                      >
                        {t('detail.rollback')}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** gateReport — veredito + métricas do gate da onda. */
function GateReportCard({ report }: { report: WifiOptGateReport }) {
  const t = useTranslations('tr069WifiOpt');
  return (
    <div
      className={`mb-4 rounded-md border p-3 text-sm ${
        report.pass
          ? 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200'
          : 'border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200'
      }`}
    >
      <p className="font-semibold">
        {t('gate.title')}: {report.pass ? t('gate.pass') : t('gate.fail')}
      </p>
      <ul className="mt-1 space-y-0.5 text-xs">
        <li>
          {t('gate.avgRssiDelta')}: {report.avgRssiDelta === null ? '—' : `${report.avgRssiDelta} dBm`}
        </li>
        <li>
          {t('gate.sustainedDrops')}:{' '}
          {report.sustainedDrops.length === 0 ? t('gate.none') : report.sustainedDrops.join(', ')}
        </li>
        <li>
          {t('gate.rolledBack')}: {report.rolledBack}
        </li>
      </ul>
    </div>
  );
}
