/**
 * WifiOptRolloutService — motor de ONDAS do pacote de otimização Wi-Fi.
 *
 * Aplica o pacote (via WifiOptService.ensureOptimized) em LOTES EXPLÍCITOS de
 * devices (deviceIds colados pelo operador — nenhum device entra em onda
 * automaticamente), com baseline → push → verificação → rollback automático.
 * Deploy com flags off é 100% inerte.
 *
 * Cadência: `@Cron(EVERY_MINUTE) tick()` com guard `running` (tick lento não
 * empilha). Push/baseline SÓ na janela de madrugada (hora local do tenant,
 * `inHourWindow` fail-closed); `checkRollback`/verificação rodam 24/7 — quebra
 * de SSID não espera a próxima madrugada pra ser desfeita.
 *
 * State machine por device (transições monotônicas; tick re-executado relê o
 * estado e não repete ação — camada 3 de idempotência do pacote):
 *
 *   QUEUED      —(janela, ONLINE, diagnóstico fresco + GET baseline DONE)→ BASELINED
 *   BASELINED   —(janela, ensureOptimized ROLLOUT_WIFI_V1 FULL)→ PUSHED
 *   PUSHED      —(task DONE + ≥1 diagnóstico > pushedAt+30min)→ VERIFYING
 *                —(task FAILED — terminal no ACS)→ FAILED
 *   VERIFYING   —(shouldRollback: baseline>0 + 2h só zeros)→ ROLLED_BACK
 *                —(2h com clientes vistos)→ APPLIED
 *   * QUEUED sem insumo após 6 tentativas → SKIPPED (offline não é falha)
 *
 * Rollback (automático OU manual) restaura APENAS `previous.ssid5` +
 * BandSteeringPolicy + `Ont.wifiBandMode` — NUNCA reverte potência/APM/
 * RegDomain/largura (requisito: são melhorias inócuas; o que quebra cliente é
 * SSID/steering). PSK nunca entra no rollback (previous não guarda senha).
 *
 * Gate da onda (todos os devices terminais): `evaluateGate` sobre agregados de
 * tr069_diagnostics (baseline copiado pro Json da wave — a série tem retenção
 * de 30d e o snapshot do device é sobrescrito a cada Inform) + zero
 * ROLLED_BACK. GATE_FAILED bloqueia a próxima onda (regra das 48h, `force`
 * destrava via API).
 *
 * @provenance Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=
 */
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Prisma, WifiBandMode, WifiOptWaveDevice } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

import {
  HUAWEI_EG8145_PATHS,
  HUAWEI_ROUTER_PATHS,
  huaweiDiagnosticParamNames,
  huaweiWifiOptReadbackNames,
  huaweiWlanPaths,
} from './tr069-paths.huawei';
import {
  canStartWave,
  evaluateGate,
  inHourWindow,
  ROLLBACK_OBSERVE_MS,
  shouldRollback,
  VERIFY_DELAY_MS,
  type GateDeviceSample,
  type WaveStatusForStart,
} from './wifi-opt-gate';
import { huaweiWifiCapabilityFor } from './wifi-opt.resolver';
import { WifiOptService } from './wifi-opt.service';

/** Opt-in global do motor de ondas (default DESLIGADO — "entra desligada"). */
const ROLLOUT_ENABLED = (process.env.WIFI_OPT_ROLLOUT_ENABLED ?? '0') === '1';
/** Janela de push/baseline (hora local do tenant). Default 02:00–05:00. */
const WINDOW_START = parseInt(process.env.WIFI_OPT_ROLLOUT_WINDOW_START ?? '2', 10);
const WINDOW_END = parseInt(process.env.WIFI_OPT_ROLLOUT_WINDOW_END ?? '5', 10);
/** Tentativas de captar baseline (device offline/sem coleta) até SKIPPED. */
const MAX_BASELINE_ATTEMPTS = 6;
/** VERIFYING sem NENHUMA amostra pós-push por este tempo → SKIPPED (sumiu). */
const VERIFY_STALL_MS = 24 * 3_600_000;
/** Diagnóstico de baseline precisa ser mais fresco que isto. */
const BASELINE_FRESH_MS = 2 * 3_600_000;
/** Teto de devices por onda (v1 — textarea de deviceIds). */
const MAX_WAVE_DEVICES = 500;

/** Estados terminais — device não é mais tocado pelo tick. */
const TERMINAL_STATES = ['APPLIED', 'ROLLED_BACK', 'SKIPPED', 'FAILED'] as const;

/** Shape do Json `baseline` (copiado de tr069_diagnostics na captura). */
interface WaveBaseline {
  capturedAt: string;
  clients24: number | null;
  clients5: number | null;
  rssiByMac: Record<string, number>;
  avgRssi: number | null;
  channel5: number | null;
}

/** Shape do Json `previous` (GET pré-push — insumo do rollback; NUNCA PSK). */
interface WavePrevious {
  ssid5: string | null;
  bandSteeringPolicy: string | null;
  ht20: string | null;
  wifiBandMode: WifiBandMode | null;
}

@Injectable()
export class WifiOptRolloutService {
  private readonly logger = new Logger(WifiOptRolloutService.name);
  /** Guard de reentrância — tick lento (DB ocupado) não empilha execução. */
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly wifiOpt: WifiOptService,
  ) {}

  // ───────────────────────────── cron ───────────────────────────────────────

  @Cron(CronExpression.EVERY_MINUTE)
  async tick(): Promise<void> {
    if (!ROLLOUT_ENABLED) return;
    if (this.running) return;
    this.running = true;
    try {
      await this.runOnce();
    } catch (err) {
      this.logger.error(`[wifi-opt-wave] tick falhou: ${String(err)}`);
    } finally {
      this.running = false;
    }
  }

  /**
   * Um passe do motor sobre TODAS as ondas RUNNING. Exposto pra rota de debug
   * `_tasks/run-tick` (padrão run-overdue-scan) — o manual pula a flag env mas
   * respeita flag de tenant e janela (mesmas garantias do cron).
   */
  async runOnce(now: Date = new Date()): Promise<{ waves: number; devices: number }> {
    const waves = await this.prisma.wifiOptWave.findMany({
      where: { status: 'RUNNING' },
      select: { id: true, tenantId: true, tenant: { select: { timezone: true } } },
    });

    let touched = 0;
    for (const wave of waves) {
      // Flag por tenant — desligar no config congela a onda (não cancela).
      const cfg = await this.prisma.tr069TenantConfig.findUnique({
        where: { tenantId: wave.tenantId },
        select: { wifiOptRolloutEnabled: true },
      });
      if (!cfg?.wifiOptRolloutEnabled) continue;

      const inWindow = inHourWindow(
        wave.tenant?.timezone ?? 'UTC',
        WINDOW_START,
        WINDOW_END,
        now,
      );

      const devices = await this.prisma.wifiOptWaveDevice.findMany({
        where: { waveId: wave.id, state: { notIn: [...TERMINAL_STATES] } },
        orderBy: { createdAt: 'asc' },
      });

      for (const wd of devices) {
        touched++;
        await this.stepDevice(wd, inWindow, now).catch((err: unknown) =>
          this.logger.error(
            `[wifi-opt-wave] wave=${wave.id} device=${wd.deviceId} step falhou: ${String(err)}`,
          ),
        );
      }

      // Todos terminais → fecha a onda com o gate de qualidade.
      if (devices.length === 0) {
        await this.evaluateWaveGate(wave.id, wave.tenantId, now).catch((err: unknown) =>
          this.logger.error(`[wifi-opt-wave] gate wave=${wave.id} falhou: ${String(err)}`),
        );
      }
    }
    return { waves: waves.length, devices: touched };
  }

  // ───────────────────────── state machine ──────────────────────────────────

  /**
   * Avança UM device na state machine. Push/baseline exigem janela; a
   * verificação/rollback (VERIFYING e PUSHED→VERIFYING) roda 24/7.
   */
  private async stepDevice(wd: WifiOptWaveDevice, inWindow: boolean, now: Date): Promise<void> {
    // Resolve o Tr069Device pelo OUI-SN (referência solta — swap deleta a row).
    const device = await this.prisma.tr069Device.findUnique({
      where: { deviceId: wd.deviceId },
      select: {
        id: true,
        tenantId: true,
        status: true,
        productClass: true,
        softwareVersion: true,
        ont: { select: { id: true, wifiBandMode: true } },
      },
    });
    if (!device || device.tenantId !== wd.tenantId) {
      await this.markState(wd.id, 'SKIPPED', now, 'device não existe mais no tenant (swap?)');
      return;
    }

    switch (wd.state) {
      case 'QUEUED':
        if (!inWindow || device.status !== 'ONLINE') return; // espera janela/online
        await this.stepQueued(wd, device, now);
        return;
      case 'BASELINED':
        if (!inWindow) return;
        await this.stepBaselined(wd, device, now);
        return;
      case 'PUSHED':
        await this.stepPushed(wd, device, now);
        return;
      case 'VERIFYING':
        await this.stepVerifying(wd, device, now);
        return;
      default:
        return; // terminal — não deveria chegar aqui (filtro do runOnce)
    }
  }

  /**
   * QUEUED → BASELINED: (a) exige linha FRESCA (<2h) de tr069_diagnostics com
   * Wi-Fi lido — senão enfileira um GET de diagnóstico dedupado e re-tenta no
   * próximo tick; (b) exige o GET `WIFI_OPT_BASELINE` (readback names — o
   * "previous" do rollback) DONE. `attempts>6` → SKIPPED (offline não é falha).
   */
  private async stepQueued(
    wd: WifiOptWaveDevice,
    device: {
      id: string;
      tenantId: string;
      productClass: string | null;
      softwareVersion: string | null;
      ont: { id: string; wifiBandMode: WifiBandMode } | null;
    },
    now: Date,
  ): Promise<void> {
    const cap = huaweiWifiCapabilityFor(device.productClass, device.softwareVersion);
    if (!cap) {
      await this.markState(wd.id, 'SKIPPED', now, `productClass sem capability: ${device.productClass ?? '∅'}`);
      return;
    }

    // (a) diagnóstico fresco com Wi-Fi (insumo do baseline de clientes/RSSI).
    const diag = await this.prisma.tr069Diagnostic.findFirst({
      where: {
        deviceId: device.id,
        wifiClients24: { not: null },
        capturedAt: { gt: new Date(now.getTime() - BASELINE_FRESH_MS) },
      },
      orderBy: { capturedAt: 'desc' },
      select: {
        capturedAt: true,
        wifiClients24: true,
        wifiClients5: true,
        wifiAvgRssi: true,
        wifiChannel5: true,
        wifiClients: true,
      },
    });
    if (!diag) {
      await this.bumpAttemptOrSkip(wd, now, 'sem diagnóstico fresco (offline/sem coleta)');
      if (wd.attempts < MAX_BASELINE_ATTEMPTS) {
        await this.ensureGet(device.tenantId, device.id, 'DIAGNOSTICS', null);
      }
      return;
    }

    // (b) GET do "previous" (readback do que o SET vai escrever, menos PSK).
    const baselineGet = await this.prisma.tr069Task.findFirst({
      where: {
        deviceId: device.id,
        action: 'GET_PARAMS',
        payload: { path: ['purpose'], equals: 'WIFI_OPT_BASELINE' },
        createdAt: { gte: wd.createdAt },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true, result: true, error: true },
    });
    if (!baselineGet) {
      await this.ensureGet(device.tenantId, device.id, 'WIFI_OPT_BASELINE', huaweiWifiOptReadbackNames(cap));
      return;
    }
    if (baselineGet.status === 'PENDING' || baselineGet.status === 'RUNNING') return; // aguarda Inform
    if (baselineGet.status !== 'DONE') {
      // GET FAILED = fault no readback (path inexistente no firmware?) — não
      // vai se resolver sozinho; melhor reprovar o device do que empurrar um
      // SET às cegas sem insumo de rollback.
      await this.markState(wd.id, 'FAILED', now, `GET baseline ${baselineGet.status}: ${baselineGet.error ?? '?'}`);
      return;
    }

    const params = (baselineGet.result as { params?: Record<string, string> } | null)?.params ?? {};
    const previous: WavePrevious = {
      ssid5: params[HUAWEI_EG8145_PATHS.ssid50] ?? null,
      bandSteeringPolicy: params[HUAWEI_ROUTER_PATHS.bandSteeringPolicy] ?? null,
      ht20: params[huaweiWlanPaths('5G').htMode] ?? null,
      wifiBandMode: device.ont?.wifiBandMode ?? null,
    };

    // rssiByMac copiado da lista por cliente ([{mac, rssi, ...}]).
    const clients = Array.isArray(diag.wifiClients)
      ? (diag.wifiClients as Array<{ mac?: string; rssi?: number | null }>)
      : [];
    const rssiByMac: Record<string, number> = {};
    for (const c of clients) {
      if (c?.mac && typeof c.rssi === 'number') rssiByMac[c.mac] = c.rssi;
    }
    const baseline: WaveBaseline = {
      capturedAt: diag.capturedAt.toISOString(),
      clients24: diag.wifiClients24,
      clients5: diag.wifiClients5,
      rssiByMac,
      avgRssi: diag.wifiAvgRssi,
      channel5: diag.wifiChannel5,
    };

    await this.prisma.wifiOptWaveDevice.update({
      where: { id: wd.id },
      data: {
        state: 'BASELINED',
        baseline: baseline as unknown as Prisma.InputJsonValue,
        previous: previous as unknown as Prisma.InputJsonValue,
        error: null,
      },
    });
    this.logger.log(`[wifi-opt-wave] device=${wd.deviceId} BASELINED (clientes=${(diag.wifiClients24 ?? 0) + (diag.wifiClients5 ?? 0)})`);
  }

  /**
   * BASELINED → PUSHED: delega ao ensureOptimized (dedupe/guard/marcadores do
   * pacote valem aqui também). Outcomes que não empurram viram terminal:
   * o rollout NÃO fica em loop esperando flag de tenant ligar.
   */
  private async stepBaselined(
    wd: WifiOptWaveDevice,
    device: { id: string },
    now: Date,
  ): Promise<void> {
    const outcome = await this.wifiOpt.ensureOptimized(device.id, {
      purpose: 'ROLLOUT_WIFI_V1',
      mode: 'FULL',
      actorKind: 'cron',
    });
    switch (outcome) {
      case 'ENQUEUED':
        await this.prisma.wifiOptWaveDevice.update({
          where: { id: wd.id },
          data: { state: 'PUSHED', pushedAt: now, error: null },
        });
        this.logger.log(`[wifi-opt-wave] device=${wd.deviceId} PUSHED`);
        return;
      case 'HELD_FAILED':
        await this.markState(wd.id, 'FAILED', now, 'última task do pacote FAILED (guard anti-loop segurou)');
        return;
      case 'NOOP':
        // Já otimizado (marcador confirmado) ou task PENDING pré-existente —
        // nada pra onda medir; fora do gate.
        await this.markState(wd.id, 'SKIPPED', now, 'ensureOptimized NOOP (já otimizado/task pendente)');
        return;
      case 'DISABLED':
        await this.markState(wd.id, 'SKIPPED', now, 'wifi-opt desligado (WIFI_OPT_ENABLED/flag do tenant)');
        return;
      case 'AWAITING_INFORM':
        return; // placeholder sem productClass — improvável pós-baseline; espera
      default:
        await this.markState(wd.id, 'SKIPPED', now, `ensureOptimized ${outcome}`);
        return;
    }
  }

  /**
   * PUSHED → VERIFYING quando a task SET ficou DONE e existe ≥1 diagnóstico
   * capturado > pushedAt+30min (o CPE aplicou e voltou a reportar). Task
   * FAILED é terminal no ACS → FAILED.
   */
  private async stepPushed(
    wd: WifiOptWaveDevice,
    device: { id: string },
    now: Date,
  ): Promise<void> {
    if (!wd.pushedAt) return; // defensivo — PUSHED sempre tem pushedAt
    const task = await this.prisma.tr069Task.findFirst({
      where: {
        deviceId: device.id,
        action: 'SET_PARAMS',
        payload: { path: ['purpose'], equals: 'ROLLOUT_WIFI_V1' },
        // margem de 1min: pushedAt é gravado logo APÓS o create da task.
        createdAt: { gte: new Date(wd.pushedAt.getTime() - 60_000) },
      },
      orderBy: { createdAt: 'desc' },
      select: { status: true, error: true },
    });
    if (!task) return; // corrida rara — re-olha no próximo tick
    if (task.status === 'FAILED') {
      await this.markState(wd.id, 'FAILED', now, `task SET FAILED: ${task.error ?? '?'}`);
      return;
    }
    if (task.status !== 'DONE') return; // PENDING/RUNNING — aguarda Inform

    const post = await this.prisma.tr069Diagnostic.count({
      where: {
        deviceId: device.id,
        capturedAt: { gt: new Date(wd.pushedAt.getTime() + VERIFY_DELAY_MS) },
      },
    });
    if (post < 1) return; // aplicado, mas ainda sem leitura pós-push
    await this.prisma.wifiOptWaveDevice.update({
      where: { id: wd.id },
      data: { state: 'VERIFYING', error: null },
    });
    this.logger.log(`[wifi-opt-wave] device=${wd.deviceId} VERIFYING`);
  }

  /**
   * VERIFYING (roda 24/7): `shouldRollback` → rollback automático; senão, 2h
   * pós-push com clientes vistos → APPLIED. 24h sem NENHUMA amostra pós-push
   * → SKIPPED (a ONT sumiu depois do push — sem dado não há veredito e a onda
   * não pode ficar aberta pra sempre).
   */
  private async stepVerifying(
    wd: WifiOptWaveDevice,
    device: { id: string; tenantId: string; ont: { id: string; wifiBandMode: WifiBandMode } | null },
    now: Date,
  ): Promise<void> {
    if (!wd.pushedAt) return;
    const rows = await this.prisma.tr069Diagnostic.findMany({
      where: {
        deviceId: device.id,
        capturedAt: { gt: new Date(wd.pushedAt.getTime() + VERIFY_DELAY_MS) },
      },
      orderBy: { capturedAt: 'asc' },
      select: { wifiClients24: true, wifiClients5: true },
    });
    const samples = rows.map((r) => ({
      clients:
        r.wifiClients24 === null && r.wifiClients5 === null
          ? null
          : (r.wifiClients24 ?? 0) + (r.wifiClients5 ?? 0),
    }));

    const baseline = (wd.baseline ?? {}) as unknown as Partial<WaveBaseline>;
    const baselineClients = (baseline.clients24 ?? 0) + (baseline.clients5 ?? 0);

    if (shouldRollback(baselineClients, samples, wd.pushedAt, now)) {
      await this.executeRollback(wd, device, now, 'automático (clientes zeraram por 2h)');
      return;
    }

    const elapsed = now.getTime() - wd.pushedAt.getTime();
    const sawClients = samples.some((s) => s.clients !== null && s.clients > 0);
    if (elapsed >= ROLLBACK_OBSERVE_MS && sawClients) {
      await this.prisma.wifiOptWaveDevice.update({
        where: { id: wd.id },
        data: { state: 'APPLIED', verifiedAt: now, error: null },
      });
      this.logger.log(`[wifi-opt-wave] device=${wd.deviceId} APPLIED`);
      return;
    }
    if (elapsed >= VERIFY_STALL_MS && samples.every((s) => s.clients === null)) {
      await this.markState(wd.id, 'SKIPPED', now, '24h sem amostras pós-push (ONT sumiu — sem veredito)');
    }
  }

  /**
   * Rollback: SET restaurando SÓ `previous.ssid5` + BandSteeringPolicy, e
   * `Ont.wifiBandMode` de volta (o `ssid5gFor()` do reconcile/updateWifi volta
   * a sufixar "-5G" se era DUAL_BAND). Potência/APM/RegDomain/largura FICAM —
   * são inócuos e reverter largura exigiria reboot.
   */
  private async executeRollback(
    wd: WifiOptWaveDevice,
    device: { id: string; tenantId: string; ont: { id: string; wifiBandMode: WifiBandMode } | null },
    now: Date,
    reason: string,
  ): Promise<void> {
    const previous = wd.previous as unknown as Partial<WavePrevious> | null;
    if (!previous || (!previous.ssid5 && previous.bandSteeringPolicy == null)) {
      await this.markState(wd.id, 'FAILED', now, 'rollback sem previous capturado — intervenção manual');
      return;
    }

    const params: Array<{ name: string; value: string; type: string }> = [];
    if (previous.ssid5) {
      params.push({ name: HUAWEI_EG8145_PATHS.ssid50, value: previous.ssid5, type: 'xsd:string' });
    }
    if (previous.bandSteeringPolicy != null) {
      params.push({
        name: HUAWEI_ROUTER_PATHS.bandSteeringPolicy,
        value: String(previous.bandSteeringPolicy),
        type: 'xsd:unsignedInt',
      });
    }

    // Dedupe padrão por purpose (rollback manual + automático não empilham).
    const pending = await this.prisma.tr069Task.findFirst({
      where: {
        deviceId: device.id,
        action: 'SET_PARAMS',
        status: 'PENDING',
        payload: { path: ['purpose'], equals: 'WIFI_OPT_ROLLBACK' },
      },
      select: { id: true },
    });
    if (!pending) {
      await this.prisma.tr069Task.create({
        data: {
          tenantId: device.tenantId,
          deviceId: device.id,
          action: 'SET_PARAMS',
          payload: { params, purpose: 'WIFI_OPT_ROLLBACK' },
          status: 'PENDING',
        },
      });
    }

    // Ont volta pro modo anterior — mantém o ssid5gFor() coerente com o CPE.
    if (
      device.ont &&
      previous.wifiBandMode &&
      (previous.wifiBandMode === 'BAND_STEERING' || previous.wifiBandMode === 'DUAL_BAND') &&
      device.ont.wifiBandMode !== previous.wifiBandMode
    ) {
      await this.prisma.ont.update({
        where: { id: device.ont.id },
        data: { wifiBandMode: previous.wifiBandMode },
      });
    }

    await this.prisma.wifiOptWaveDevice.update({
      where: { id: wd.id },
      data: { state: 'ROLLED_BACK', rolledBackAt: now, error: reason },
    });
    this.logger.warn(`[wifi-opt-wave] device=${wd.deviceId} ROLLED_BACK (${reason})`);
  }

  /**
   * Fecha a onda quando todos os devices são terminais: `evaluateGate` sobre
   * agregados pós-push de tr069_diagnostics (molde do getWifiCoverage) vs os
   * baselines copiados na wave, + zero ROLLED_BACK.
   */
  private async evaluateWaveGate(waveId: string, tenantId: string, now: Date): Promise<void> {
    const devices = await this.prisma.wifiOptWaveDevice.findMany({
      where: { waveId },
      select: { deviceId: true, state: true, baseline: true, pushedAt: true },
    });
    if (devices.length === 0) {
      // Onda vazia (deviceIds não bateram com nada) — encerra reprovada.
      await this.prisma.wifiOptWave.update({
        where: { id: waveId },
        data: {
          status: 'GATE_FAILED',
          completedAt: now,
          gateReport: { avgRssiDelta: null, sustainedDrops: [], rolledBack: 0, pass: false, note: 'onda sem devices' },
        },
      });
      return;
    }

    const rolledBack = devices.filter((d) => d.state === 'ROLLED_BACK').length;
    const baselineSamples: GateDeviceSample[] = [];
    const postSamples: GateDeviceSample[] = [];

    // Amostras só de quem chegou ao fim do funil COM baseline + push.
    for (const d of devices) {
      if (d.state !== 'APPLIED' || !d.baseline || !d.pushedAt) continue;
      const b = d.baseline as unknown as Partial<WaveBaseline>;
      baselineSamples.push({
        deviceId: d.deviceId,
        avgRssi: b.avgRssi ?? null,
        clients:
          b.clients24 == null && b.clients5 == null ? null : (b.clients24 ?? 0) + (b.clients5 ?? 0),
      });
      const dev = await this.prisma.tr069Device.findUnique({
        where: { deviceId: d.deviceId },
        select: { id: true },
      });
      if (!dev) continue;
      const agg = await this.prisma.tr069Diagnostic.aggregate({
        where: {
          deviceId: dev.id,
          capturedAt: { gt: new Date(d.pushedAt.getTime() + VERIFY_DELAY_MS) },
        },
        _avg: { wifiAvgRssi: true, wifiClients24: true, wifiClients5: true },
        _count: { _all: true },
      });
      if (agg._count._all === 0) continue; // device sem amostras — fora do gate
      const c24 = agg._avg.wifiClients24;
      const c5 = agg._avg.wifiClients5;
      postSamples.push({
        deviceId: d.deviceId,
        avgRssi: agg._avg.wifiAvgRssi === null ? null : Math.round(agg._avg.wifiAvgRssi),
        clients: c24 === null && c5 === null ? null : Math.round((c24 ?? 0) + (c5 ?? 0)),
      });
    }

    const gate = evaluateGate(baselineSamples, postSamples);
    const pass = gate.pass && rolledBack === 0;
    await this.prisma.wifiOptWave.update({
      where: { id: waveId },
      data: {
        status: pass ? 'GATE_PASSED' : 'GATE_FAILED',
        completedAt: now,
        gateReport: {
          avgRssiDelta: gate.avgRssiDelta,
          sustainedDrops: gate.sustainedDrops,
          rolledBack,
          pass,
        },
      },
    });
    this.logger.log(
      `[wifi-opt-wave] wave=${waveId} tenant=${tenantId} ${pass ? 'GATE_PASSED' : 'GATE_FAILED'} ` +
        `(delta=${gate.avgRssiDelta ?? '∅'}dBm drops=${gate.sustainedDrops.length} rolledBack=${rolledBack})`,
    );
  }

  // ───────────────────────── API (controller) ───────────────────────────────

  /** Lista as ondas do tenant com progresso por estado (painel). */
  async listWaves(tenantId: string) {
    const waves = await this.prisma.wifiOptWave.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    const counts = await this.prisma.wifiOptWaveDevice.groupBy({
      by: ['waveId', 'state'],
      where: { waveId: { in: waves.map((w) => w.id) } },
      _count: { _all: true },
    });
    const byWave = new Map<string, Record<string, number>>();
    for (const c of counts) {
      const m = byWave.get(c.waveId) ?? {};
      m[c.state] = c._count._all;
      byWave.set(c.waveId, m);
    }
    return waves.map((w) => ({
      id: w.id,
      name: w.name,
      status: w.status,
      startedAt: w.startedAt?.toISOString() ?? null,
      completedAt: w.completedAt?.toISOString() ?? null,
      gateReport: w.gateReport,
      createdAt: w.createdAt.toISOString(),
      deviceCounts: byWave.get(w.id) ?? {},
    }));
  }

  /** Detalhe de uma onda com os devices e seus estados. */
  async getWave(tenantId: string, waveId: string) {
    const wave = await this.prisma.wifiOptWave.findFirst({
      where: { id: waveId, tenantId },
      include: { devices: { orderBy: { createdAt: 'asc' } } },
    });
    if (!wave) throw new NotFoundException('Onda não encontrada');
    return {
      id: wave.id,
      name: wave.name,
      status: wave.status,
      startedAt: wave.startedAt?.toISOString() ?? null,
      completedAt: wave.completedAt?.toISOString() ?? null,
      gateReport: wave.gateReport,
      createdAt: wave.createdAt.toISOString(),
      devices: wave.devices.map((d) => ({
        id: d.id,
        deviceId: d.deviceId,
        ontId: d.ontId,
        state: d.state,
        attempts: d.attempts,
        error: d.error,
        baseline: d.baseline,
        pushedAt: d.pushedAt?.toISOString() ?? null,
        verifiedAt: d.verifiedAt?.toISOString() ?? null,
        rolledBackAt: d.rolledBackAt?.toISOString() ?? null,
      })),
    };
  }

  /**
   * Cria a onda em DRAFT a partir da lista EXPLÍCITA de deviceIds (OUI-SN,
   * textarea do operador — v1). Só entram devices que existem no tenant;
   * os não encontrados voltam na resposta pro operador conferir.
   */
  async createWave(tenantId: string, input: { name: string; deviceIds: string[] }) {
    const unique = [...new Set(input.deviceIds.map((d) => d.trim()).filter(Boolean))];
    if (unique.length === 0) throw new BadRequestException('Informe ao menos um deviceId');
    if (unique.length > MAX_WAVE_DEVICES) {
      throw new BadRequestException(`Máximo de ${MAX_WAVE_DEVICES} devices por onda`);
    }

    const known = await this.prisma.tr069Device.findMany({
      where: { tenantId, deviceId: { in: unique } },
      select: { deviceId: true, ontId: true },
    });
    if (known.length === 0) {
      throw new BadRequestException('Nenhum dos deviceIds existe neste tenant');
    }
    const knownIds = new Set(known.map((d) => d.deviceId));

    const wave = await this.prisma.wifiOptWave.create({
      data: {
        tenantId,
        name: input.name,
        devices: {
          create: known.map((d) => ({
            tenantId,
            deviceId: d.deviceId,
            ontId: d.ontId,
          })),
        },
      },
    });
    this.logger.log(
      `[wifi-opt-wave] wave=${wave.id} criada com ${known.length}/${unique.length} device(s)`,
    );
    return {
      id: wave.id,
      name: wave.name,
      status: wave.status,
      deviceCount: known.length,
      unknownDeviceIds: unique.filter((d) => !knownIds.has(d)),
    };
  }

  /**
   * Inicia a onda: sem outra RUNNING no tenant + regra das 48h/GATE_PASSED
   * (`canStartWave`; `force` destrava — rota já exige tr069.admin).
   */
  async startWave(tenantId: string, waveId: string, force = false, now: Date = new Date()) {
    const wave = await this.prisma.wifiOptWave.findFirst({
      where: { id: waveId, tenantId },
      select: { id: true, status: true },
    });
    if (!wave) throw new NotFoundException('Onda não encontrada');
    if (wave.status !== 'DRAFT') {
      throw new BadRequestException(`Onda em ${wave.status} — só DRAFT pode iniciar`);
    }

    const running = await this.prisma.wifiOptWave.findFirst({
      where: { tenantId, status: 'RUNNING' },
      select: { id: true },
    });
    if (running) {
      throw new BadRequestException(`Já existe onda RUNNING (${running.id}) — cancele ou aguarde`);
    }

    const last = await this.prisma.wifiOptWave.findFirst({
      where: { tenantId, status: { in: ['GATE_PASSED', 'GATE_FAILED', 'CANCELLED'] } },
      orderBy: { completedAt: { sort: 'desc', nulls: 'last' } },
      select: { status: true, completedAt: true },
    });
    const gate = canStartWave(
      last ? { status: last.status as WaveStatusForStart, completedAt: last.completedAt } : null,
      now,
      force,
    );
    if (!gate.ok) throw new BadRequestException(gate.reason ?? 'Bloqueado pela regra das 48h');

    await this.prisma.wifiOptWave.update({
      where: { id: waveId },
      data: { status: 'RUNNING', startedAt: now },
    });
    this.logger.log(`[wifi-opt-wave] wave=${waveId} RUNNING${force ? ' (force)' : ''}`);
    return { id: waveId, status: 'RUNNING' as const };
  }

  /** Aborta a onda (devices não-terminais ficam como estão — sem push novo). */
  async cancelWave(tenantId: string, waveId: string, now: Date = new Date()) {
    const wave = await this.prisma.wifiOptWave.findFirst({
      where: { id: waveId, tenantId },
      select: { id: true, status: true },
    });
    if (!wave) throw new NotFoundException('Onda não encontrada');
    if (wave.status !== 'DRAFT' && wave.status !== 'RUNNING') {
      throw new BadRequestException(`Onda em ${wave.status} — nada a cancelar`);
    }
    await this.prisma.wifiOptWave.update({
      where: { id: waveId },
      data: { status: 'CANCELLED', completedAt: now },
    });
    this.logger.log(`[wifi-opt-wave] wave=${waveId} CANCELLED`);
    return { id: waveId, status: 'CANCELLED' as const };
  }

  /**
   * Rollback MANUAL de um device da onda (operador viu problema antes do
   * automático). Vale pra quem já foi empurrado (PUSHED/VERIFYING/APPLIED).
   */
  async rollbackDevice(tenantId: string, waveDeviceId: string, now: Date = new Date()) {
    const wd = await this.prisma.wifiOptWaveDevice.findFirst({
      where: { id: waveDeviceId, tenantId },
    });
    if (!wd) throw new NotFoundException('Device da onda não encontrado');
    if (!['PUSHED', 'VERIFYING', 'APPLIED'].includes(wd.state)) {
      throw new BadRequestException(`Device em ${wd.state} — rollback só após o push`);
    }
    const device = await this.prisma.tr069Device.findUnique({
      where: { deviceId: wd.deviceId },
      select: {
        id: true,
        tenantId: true,
        ont: { select: { id: true, wifiBandMode: true } },
      },
    });
    if (!device || device.tenantId !== tenantId) {
      throw new BadRequestException('Device não existe mais no tenant (swap?)');
    }
    await this.executeRollback(wd, device, now, 'manual (operador)');
    return { id: wd.id, state: 'ROLLED_BACK' as const };
  }

  // ───────────────────────────── helpers ────────────────────────────────────

  /** Incrementa `attempts`; estourou o teto → SKIPPED (offline não é falha). */
  private async bumpAttemptOrSkip(wd: WifiOptWaveDevice, now: Date, note: string): Promise<void> {
    if (wd.attempts + 1 > MAX_BASELINE_ATTEMPTS) {
      await this.markState(wd.id, 'SKIPPED', now, `${note} após ${wd.attempts + 1} tentativas`);
      return;
    }
    await this.prisma.wifiOptWaveDevice.update({
      where: { id: wd.id },
      data: { attempts: { increment: 1 }, error: note },
    });
  }

  /** Marca estado terminal com carimbo apropriado + nota legível. */
  private async markState(
    waveDeviceId: string,
    state: 'SKIPPED' | 'FAILED' | 'ROLLED_BACK',
    now: Date,
    error: string | null,
  ): Promise<void> {
    await this.prisma.wifiOptWaveDevice.update({
      where: { id: waveDeviceId },
      data: {
        state,
        error,
        ...(state === 'ROLLED_BACK' ? { rolledBackAt: now } : {}),
      },
    });
    if (state === 'FAILED') {
      this.logger.warn(`[wifi-opt-wave] waveDevice=${waveDeviceId} FAILED: ${error ?? '?'}`);
    }
  }

  /**
   * Enfileira um GET dedupado por purpose (cópia do ensureReconcileGet).
   * `names=null` = coleta de diagnóstico padrão: o conjunto canônico Huawei
   * (o pacote é 100% Huawei — mesmo gate de vendor do ensureOptimized).
   */
  private async ensureGet(
    tenantId: string,
    deviceDbId: string,
    purpose: 'DIAGNOSTICS' | 'WIFI_OPT_BASELINE',
    names: string[] | null,
  ): Promise<void> {
    const pending = await this.prisma.tr069Task.findFirst({
      where: {
        deviceId: deviceDbId,
        action: 'GET_PARAMS',
        status: 'PENDING',
        payload: { path: ['purpose'], equals: purpose },
      },
      select: { id: true },
    });
    if (pending) return;
    await this.prisma.tr069Task.create({
      data: {
        tenantId,
        deviceId: deviceDbId,
        action: 'GET_PARAMS',
        payload: { names: names ?? huaweiDiagnosticParamNames(), purpose },
        status: 'PENDING',
      },
    });
  }
}
