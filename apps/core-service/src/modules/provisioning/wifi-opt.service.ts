/**
 * WifiOptService — orquestrador dos GATILHOS do pacote de otimização Wi-Fi
 * Huawei (netx-cpe). Decide QUANDO aplicar; o QUE aplicar mora em
 * wifi-opt.resolver.ts (puro) e a montagem TR-069 em tr069-paths.huawei.ts
 * (`huaweiWifiOptParams`).
 *
 * Gatilhos:
 *   1. Ativação (install/reprovision/swap) → `applyOnActivation` (best-effort,
 *      NUNCA lança — semântica do passo 5 do install: Wi-Fi é nice-to-have).
 *   2. Mudança de plano → `reevaluateForContract` (via WifiOptEventsHandler no
 *      bus, que é acelerador best-effort — ack-sem-retry, off por default).
 *   3. `sweepDue()` horário — a GARANTIA quando o bus está off/evento se perdeu:
 *      (a) bootstrap deferido pós-Inform (install novo tem device placeholder
 *          SEM productClass — não dá pra resolver capability até o 1º Inform);
 *      (b) confirma `wifiOptAppliedAt` quando a task SET do pacote ficou DONE;
 *      (c) drift do profile-alvo vs `wifiOptProfile` → WIDTH_ONLY (batch,
 *          converge em horas — aceitável pra largura de canal).
 *
 * Flags (entra 100% desligado — duplo opt-in):
 *   - env global `WIFI_OPT_ENABLED` (default '0', padrão TR069_AUTO_REBOOT_ENABLED);
 *   - `Tr069TenantConfig.wifiOptEnabled` por tenant (PUT /v1/tr069/config).
 *
 * Idempotência (4 camadas — nenhuma depende do dedup em memória do bus):
 *   1. Dedupe de task por purpose (findFirst PENDING payload.purpose=X, cópia
 *      do ensureReconcileGet) + guard anti-loop: última task FAILED do mesmo
 *      purpose SEM mudança de insumo (profile/mode) → segura + log (FAILED é
 *      terminal no ACS, sem retry — re-enfileirar seria loop infinito).
 *   2. Marcador por device (`wifiOptProfile`/`wifiOptAppliedAt`): alvo==atual
 *      → no-op; re-entrega at-least-once do evento relê o DB e não faz nada.
 *   3. Estado por onda (WifiOptRolloutService — estágio próprio).
 *   4. `provisioning_events` = auditoria append-only, pode duplicar sem dano.
 *
 * Precedência com reconcile/profiles: params do pacote NUNCA entram como
 * Tr069ProfileRule (regra operacional no help da UI). SSID 5G não briga porque
 * o FULL flipa `Ont.wifiBandMode='BAND_STEERING'` — `ssid5gFor()` converge.
 *
 * @provenance Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=
 */
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Prisma, ProvisioningEventStatus } from '@prisma/client';

import { CryptoService } from '../crypto/crypto.service';
import { PrismaService } from '../prisma/prisma.service';

import { huaweiWifiOptParams } from './tr069-paths.huawei';
import { vendorFor } from './tr069-paths.registry';
import {
  huaweiWifiCapabilityFor,
  resolveWifiOptProfile,
  widthCodeFor,
  type WifiOptMode,
} from './wifi-opt.resolver';

/** Opt-in global (default DESLIGADO — invariante "entra desligada"). */
const ENABLED = (process.env.WIFI_OPT_ENABLED ?? '0') === '1';
/** Devices processados por item do sweeper horário. */
const SWEEP_BATCH = parseInt(process.env.WIFI_OPT_SWEEP_BATCH ?? '200', 10);
/** Janela de rescan do bootstrap deferido (dias) — ONT que nunca informou
 *  em N dias é abandonada pelo sweeper (evento PENDING fica só como auditoria). */
const BOOTSTRAP_LOOKBACK_DAYS = parseInt(
  process.env.WIFI_OPT_BOOTSTRAP_LOOKBACK_DAYS ?? '30',
  10,
);

/**
 * Purposes das tasks SET do pacote (chave do dedupe/guard). BASELINE/ROLLBACK
 * são do motor de ondas (WifiOptRolloutService) — não passam por aqui.
 */
export type WifiOptPurpose =
  | 'WIFI_OPT_BOOTSTRAP'
  | 'WIFI_OPT_PLAN_CHANGE'
  | 'ROLLOUT_WIFI_V1';

/** Todos os purposes que empurram o pacote (o sweeper (b) confirma qualquer um). */
const WIFI_OPT_SET_PURPOSES: WifiOptPurpose[] = [
  'WIFI_OPT_BOOTSTRAP',
  'WIFI_OPT_PLAN_CHANGE',
  'ROLLOUT_WIFI_V1',
];

/** Resultado de ensureOptimized — insumo de log/decisão dos callers. */
export type EnsureOptimizedOutcome =
  /** Task SET criada (marcadores atualizados). */
  | 'ENQUEUED'
  /** Nada a fazer: alvo==atual, ou já existe task PENDING do purpose. */
  | 'NOOP'
  /** Gate de skip: vendor≠Huawei, capability desconhecida, sem SSID/PSK, sem nó HT20. */
  | 'SKIPPED'
  /** Placeholder sem productClass — o sweeper horário resolve pós-Inform. */
  | 'AWAITING_INFORM'
  /** Flag env/tenant desligada — pacote 100% inerte. */
  | 'DISABLED'
  /** Última task do purpose FAILED sem mudança de insumo — segurada (anti-loop). */
  | 'HELD_FAILED';

export interface EnsureOptimizedOpts {
  purpose: WifiOptPurpose;
  mode: WifiOptMode;
  /** Quem disparou — vai pro ProvisioningEvent ("user"|"cron"|"system"). */
  actorKind?: string;
  actorUserId?: string | null;
}

/** Projeção do device com tudo que o pacote precisa decidir. */
const DEVICE_SELECT = {
  id: true,
  tenantId: true,
  deviceId: true,
  manufacturer: true,
  productClass: true,
  softwareVersion: true,
  wifiOptProfile: true,
  wifiOptAppliedAt: true,
  ont: {
    select: {
      id: true,
      oltId: true,
      snGpon: true,
      wifiBandMode: true,
      contract: {
        select: { id: true, bandwidthMbps: true, ssid: true, wifiPasswordEnc: true },
      },
    },
  },
} satisfies Prisma.Tr069DeviceSelect;

@Injectable()
export class WifiOptService {
  private readonly logger = new Logger(WifiOptService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  /** Duplo opt-in: env global E flag do tenant (default false). */
  async isEnabled(tenantId: string): Promise<boolean> {
    if (!ENABLED) return false;
    const cfg = await this.prisma.tr069TenantConfig.findUnique({
      where: { tenantId },
      select: { wifiOptEnabled: true },
    });
    return cfg?.wifiOptEnabled ?? false;
  }

  /**
   * Núcleo do pacote: gates → resolve profile/params → dedupe → cria a task
   * SET_PARAMS → atualiza marcadores → auditoria. Idempotente por construção
   * (camadas 1-2 do cabeçalho). PODE lançar (erro de DB) — os gatilhos de
   * ativação passam por `applyOnActivation`, que engole; o sweeper faz catch
   * por device.
   */
  async ensureOptimized(
    deviceDbId: string,
    opts: EnsureOptimizedOpts,
  ): Promise<EnsureOptimizedOutcome> {
    if (!ENABLED) return 'DISABLED';

    const device = await this.prisma.tr069Device.findUnique({
      where: { id: deviceDbId },
      select: DEVICE_SELECT,
    });
    if (!device) return 'SKIPPED';

    // Flag por tenant + domínio regulatório (config é a fonte do regDomain).
    const cfg = await this.prisma.tr069TenantConfig.findUnique({
      where: { tenantId: device.tenantId },
      select: { wifiOptEnabled: true, wifiOptRegDomain: true },
    });
    if (!cfg?.wifiOptEnabled) return 'DISABLED';

    // Gate de vendor: o pacote é 100% Huawei (paths X_HW_*). O placeholder
    // pré-Inform já nasce com manufacturer coerente (placeholderIdentityFor).
    if (vendorFor(device.manufacturer, device.ont?.snGpon) !== 'HUAWEI') {
      return 'SKIPPED';
    }

    // Install novo → placeholder SEM productClass: não dá pra resolver a
    // capability ainda. Grava PENDING (auditoria que o sweeper usa como
    // candidato) e devolve a bola pro sweepDue() horário pós-1º Inform.
    if (!device.productClass) {
      await this.persistEvent({
        tenantId: device.tenantId,
        contractId: device.ont?.contract?.id ?? null,
        ontId: device.ont?.id ?? null,
        oltId: device.ont?.oltId ?? null,
        status: 'PENDING',
        payload: {
          deviceDbId: device.id,
          deviceId: device.deviceId,
          purpose: opts.purpose,
          mode: opts.mode,
          reason: 'AWAITING_INFORM',
        },
        actorUserId: opts.actorUserId,
        actorKind: opts.actorKind,
      });
      return 'AWAITING_INFORM';
    }

    // Capability desconhecida → SKIP integral (fault 9005 do Huawei é atômico
    // e mata o SET inteiro — nunca chutar params em modelo não sondado).
    const cap = huaweiWifiCapabilityFor(device.productClass, device.softwareVersion);
    if (!cap) {
      this.logger.log(
        `[wifi-opt] device=${device.id} productClass=${device.productClass} sem capability mapeada — skip`,
      );
      return 'SKIPPED';
    }

    // Profile pela velocidade REAL do contrato (bandwidthMbps — o valor que o
    // RADIUS aplica). Sem contrato → BASE por construção (nunca GIGA).
    const contract = device.ont?.contract ?? null;
    const profile = resolveWifiOptProfile(contract?.bandwidthMbps, cap);

    // Camada 2 — marcador por device: alvo==atual → no-op.
    //   WIDTH_ONLY: profile igual = largura igual, nada a escrever.
    //   FULL: só é no-op se o push anterior CONFIRMOU (appliedAt setado pelo
    //   sweeper (b)) — senão re-enfileira (dedupe da camada 1 segura repetição).
    if (device.wifiOptProfile === profile) {
      if (opts.mode === 'WIDTH_ONLY') return 'NOOP';
      if (device.wifiOptAppliedAt) return 'NOOP';
    }

    // FULL re-escreve SSID/PSK da 5G (pré-requisito do band steering) — sem
    // Wi-Fi no contrato não tem o que unificar (a ativação já pulou o SET de
    // Wi-Fi nesse caso; atendimento define depois e o sweeper re-tenta).
    const ssid = contract?.ssid ?? null;
    const psk = contract?.wifiPasswordEnc
      ? this.crypto.decrypt(contract.wifiPasswordEnc)
      : null;
    if (opts.mode === 'FULL' && (!ssid || !psk)) {
      this.logger.log(`[wifi-opt] device=${device.id} contrato sem SSID/senha — skip FULL`);
      return 'SKIPPED';
    }

    // Camada 1 — dedupe por purpose (cópia do ensureReconcileGet): já tem task
    // PENDING deste purpose aguardando o próximo Inform → não empilha.
    const pending = await this.prisma.tr069Task.findFirst({
      where: {
        deviceId: device.id,
        action: 'SET_PARAMS',
        status: 'PENDING',
        payload: { path: ['purpose'], equals: opts.purpose },
      },
      select: { id: true },
    });
    if (pending) return 'NOOP';

    // Complemento anti-loop: FAILED é TERMINAL no ACS (sem retry). Se a última
    // task deste purpose falhou e o insumo (profile+mode) não mudou, re-criar
    // seria loop de fault eterno — segura e loga (o guard destrava sozinho
    // quando o plano/capability mudam o profile-alvo).
    const last = await this.prisma.tr069Task.findFirst({
      where: {
        deviceId: device.id,
        action: 'SET_PARAMS',
        payload: { path: ['purpose'], equals: opts.purpose },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true, payload: true },
    });
    if (last?.status === 'FAILED') {
      const lastPayload = last.payload as { profile?: string; mode?: string } | null;
      if (lastPayload?.profile === profile && lastPayload?.mode === opts.mode) {
        this.logger.warn(
          `[wifi-opt] device=${device.id} purpose=${opts.purpose} última task ` +
            `FAILED (${last.id}) sem mudança de insumo — segurando re-enfileiramento`,
        );
        return 'HELD_FAILED';
      }
    }

    // Montagem dos params (variantes por capability). WIDTH_ONLY em modelo sem
    // nó HT20 devolve lista VAZIA → não cria task (nada útil a escrever).
    const params = huaweiWifiOptParams({
      cap,
      profile,
      regDomain: cfg.wifiOptRegDomain,
      ssid: ssid ?? '',
      psk: psk ?? '',
      mode: opts.mode,
    });
    if (params.length === 0) {
      this.logger.log(
        `[wifi-opt] device=${device.id} sem params aplicáveis (mode=${opts.mode}, ht20=${cap.ht20}) — skip`,
      );
      return 'SKIPPED';
    }

    // profile/mode no payload = insumo do guard anti-loop acima (comparação de
    // "mudou o insumo?" sem re-derivar params).
    const task = await this.prisma.tr069Task.create({
      data: {
        tenantId: device.tenantId,
        deviceId: device.id,
        contractId: contract?.id ?? null,
        action: 'SET_PARAMS',
        payload: { params, purpose: opts.purpose, profile, mode: opts.mode },
        status: 'PENDING',
      },
    });

    // Marcador: profile-ALVO no device; appliedAt zera até o sweeper (b)
    // confirmar a task DONE (é ele que distingue "empurrado" de "aplicado").
    await this.prisma.tr069Device.update({
      where: { id: device.id },
      data: { wifiOptProfile: profile, wifiOptAppliedAt: null },
    });

    // FULL unifica o SSID 5G → o Ont PRECISA acompanhar (crítico: alinha o
    // ssid5gFor() do reconcile/updateWifi com o nome unificado — sem isso o
    // reconcile devolveria o sufixo "-5G" e entraria em tug-of-war).
    if (opts.mode === 'FULL' && device.ont && device.ont.wifiBandMode !== 'BAND_STEERING') {
      await this.prisma.ont.update({
        where: { id: device.ont.id },
        data: { wifiBandMode: 'BAND_STEERING' },
      });
    }

    await this.persistEvent({
      tenantId: device.tenantId,
      contractId: contract?.id ?? null,
      ontId: device.ont?.id ?? null,
      oltId: device.ont?.oltId ?? null,
      status: 'SUCCESS',
      payload: {
        deviceDbId: device.id,
        deviceId: device.deviceId,
        taskId: task.id,
        purpose: opts.purpose,
        mode: opts.mode,
        profile,
        widthCode: widthCodeFor(profile, cap),
        paramCount: params.length,
      },
      actorUserId: opts.actorUserId,
      actorKind: opts.actorKind,
    });

    this.logger.log(
      `[wifi-opt] device=${device.id} purpose=${opts.purpose} mode=${opts.mode} ` +
        `profile=${profile} → task ${task.id} (${params.length} params)`,
    );
    return 'ENQUEUED';
  }

  /**
   * Gatilho de ativação (install/reprovision/swap) — wrapper best-effort:
   * NUNCA lança (falha loga warn + evento FAILED; a ativação segue — mesma
   * semântica do passo 5 do install, Wi-Fi é nice-to-have). Multi-tenancy
   * estrito: valida que o device é do tenant antes de agir (padrão
   * enqueueReboot).
   */
  async applyOnActivation(
    tenantId: string,
    deviceDbId: string,
    actorUserId?: string | null,
  ): Promise<void> {
    try {
      const dev = await this.prisma.tr069Device.findFirst({
        where: { id: deviceDbId, tenantId },
        select: { id: true },
      });
      if (!dev) return;
      const outcome = await this.ensureOptimized(deviceDbId, {
        purpose: 'WIFI_OPT_BOOTSTRAP',
        mode: 'FULL',
        actorKind: actorUserId ? 'user' : 'system',
        actorUserId,
      });
      if (outcome !== 'DISABLED') {
        this.logger.log(`[wifi-opt] bootstrap device=${deviceDbId} → ${outcome}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[wifi-opt] bootstrap device=${deviceDbId} falhou: ${msg}`);
      // Auditoria da falha — também best-effort (engole erro do próprio log).
      await this.persistEvent({
        tenantId,
        contractId: null,
        ontId: null,
        oltId: null,
        status: 'FAILED',
        payload: { deviceDbId, purpose: 'WIFI_OPT_BOOTSTRAP' },
        error: msg,
        actorUserId,
        actorKind: actorUserId ? 'user' : 'system',
      }).catch(() => undefined);
    }
  }

  /**
   * Gatilho de mudança de plano (fast-path via bus). Idempotente: RELÊ
   * `contract.bandwidthMbps` + capability do DB — o payload do evento só
   * fornece IDs (re-entrega at-least-once não repete ação). Só age em device
   * que JÁ passou pelo pacote (`wifiOptProfile` setado) — plan-change nunca
   * bootstrapa; e só re-escreve a LARGURA (WIDTH_ONLY, sem SSID/PSK).
   */
  async reevaluateForContract(tenantId: string, contractId: string): Promise<void> {
    if (!ENABLED) return;
    const contract = await this.prisma.contract.findFirst({
      where: { id: contractId, tenantId, deletedAt: null },
      select: {
        bandwidthMbps: true,
        ont: {
          select: {
            tr069Device: {
              select: {
                id: true,
                productClass: true,
                softwareVersion: true,
                wifiOptProfile: true,
              },
            },
          },
        },
      },
    });
    const device = contract?.ont?.tr069Device;
    if (!contract || !device?.wifiOptProfile) return;

    const cap = huaweiWifiCapabilityFor(device.productClass, device.softwareVersion);
    if (!cap) return;
    const target = resolveWifiOptProfile(contract.bandwidthMbps, cap);
    if (target === device.wifiOptProfile) return;

    await this.ensureOptimized(device.id, {
      purpose: 'WIFI_OPT_PLAN_CHANGE',
      mode: 'WIDTH_ONLY',
      actorKind: 'system',
    });
  }

  /**
   * Sweeper horário — a GARANTIA do pacote (bus é só acelerador). Ordem: (b)
   * antes de (a)/(c) pra o drift enxergar confirmações frescas. Cada item tem
   * catch próprio — um device podre não trava a varredura.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async sweepDue(): Promise<void> {
    if (!ENABLED) return;
    await this.sweepConfirmApplied().catch((err: unknown) =>
      this.logger.error(`[wifi-opt] sweep confirmações falhou: ${String(err)}`),
    );
    await this.sweepDeferredBootstrap().catch((err: unknown) =>
      this.logger.error(`[wifi-opt] sweep bootstrap deferido falhou: ${String(err)}`),
    );
    await this.sweepProfileDrift().catch((err: unknown) =>
      this.logger.error(`[wifi-opt] sweep drift de profile falhou: ${String(err)}`),
    );
  }

  /**
   * (b) Confirma `wifiOptAppliedAt` quando a task SET do pacote ficou DONE.
   * Candidatos = profile-alvo setado mas ainda sem confirmação (o próprio
   * ensureOptimized zera appliedAt a cada push).
   */
  private async sweepConfirmApplied(): Promise<void> {
    const devices = await this.prisma.tr069Device.findMany({
      where: { wifiOptProfile: { not: null }, wifiOptAppliedAt: null },
      select: { id: true },
      take: SWEEP_BATCH,
    });
    for (const d of devices) {
      const done = await this.prisma.tr069Task.findFirst({
        where: {
          deviceId: d.id,
          action: 'SET_PARAMS',
          status: 'DONE',
          OR: WIFI_OPT_SET_PURPOSES.map((p) => ({
            payload: { path: ['purpose'], equals: p },
          })),
        },
        orderBy: { completedAt: 'desc' },
        select: { completedAt: true },
      });
      if (!done) continue; // ainda PENDING/RUNNING (ou FAILED — guard segura)
      await this.prisma.tr069Device.update({
        where: { id: d.id },
        data: { wifiOptAppliedAt: done.completedAt ?? new Date() },
      });
    }
  }

  /**
   * (a) Bootstrap deferido: candidatos vêm dos ProvisioningEvent PENDING que o
   * ensureOptimized gravou quando o device ainda era placeholder sem
   * productClass. events é auditoria append-only — o "fura-fila" é o filtro
   * por estado atual do device (já otimizado ou ainda sem Inform → pula), não
   * um update no evento. Janela de N dias evita rescanear pra sempre ONT que
   * nunca informou.
   */
  private async sweepDeferredBootstrap(): Promise<void> {
    const since = new Date(Date.now() - BOOTSTRAP_LOOKBACK_DAYS * 86_400_000);
    const events = await this.prisma.provisioningEvent.findMany({
      where: { action: 'TR069_WIFI_OPT', status: 'PENDING', createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      select: { payload: true },
      // Eventos podem duplicar (re-ativação/re-provision) — margem pro dedupe.
      take: SWEEP_BATCH * 5,
    });
    const candidates = new Set<string>();
    for (const e of events) {
      const p = e.payload as { deviceDbId?: string } | null;
      if (p?.deviceDbId) candidates.add(p.deviceDbId);
    }

    let processed = 0;
    for (const deviceDbId of candidates) {
      if (processed >= SWEEP_BATCH) break;
      const dev = await this.prisma.tr069Device.findUnique({
        where: { id: deviceDbId },
        select: { id: true, productClass: true, wifiOptProfile: true },
      });
      // Sumiu (swap deletou), já otimizado, ou ainda sem 1º Inform → pula sem
      // consumir cota (o candidato barato de descartar não conta no batch).
      if (!dev || dev.wifiOptProfile || !dev.productClass) continue;
      processed++;
      await this.ensureOptimized(dev.id, {
        purpose: 'WIFI_OPT_BOOTSTRAP',
        mode: 'FULL',
        actorKind: 'cron',
      }).catch((err: unknown) =>
        this.logger.warn(
          `[wifi-opt] sweep bootstrap device=${dev.id} falhou: ${String(err)}`,
        ),
      );
    }
    if (processed > 0) {
      this.logger.log(`[wifi-opt] sweep bootstrap deferido processou ${processed} device(s)`);
    }
  }

  /**
   * (c) Drift: profile-alvo (bandwidthMbps atual + capability) divergiu do
   * `wifiOptProfile` marcado → WIDTH_ONLY. É a rede de segurança do
   * plan-change com bus off/evento perdido. Batch 200/h converge em horas —
   * aceitável pra largura de canal; e cada push atualiza o marcador na hora,
   * então o conjunto drifted SÓ encolhe (sem starvation).
   */
  private async sweepProfileDrift(): Promise<void> {
    const devices = await this.prisma.tr069Device.findMany({
      where: { status: 'ONLINE', wifiOptProfile: { not: null } },
      select: {
        id: true,
        productClass: true,
        softwareVersion: true,
        wifiOptProfile: true,
        ont: { select: { contract: { select: { bandwidthMbps: true } } } },
      },
      take: SWEEP_BATCH,
    });
    for (const d of devices) {
      const bw = d.ont?.contract?.bandwidthMbps;
      if (bw == null) continue;
      const cap = huaweiWifiCapabilityFor(d.productClass, d.softwareVersion);
      if (!cap) continue;
      const target = resolveWifiOptProfile(bw, cap);
      if (target === d.wifiOptProfile) continue;
      await this.ensureOptimized(d.id, {
        purpose: 'WIFI_OPT_PLAN_CHANGE',
        mode: 'WIDTH_ONLY',
        actorKind: 'cron',
      }).catch((err: unknown) =>
        this.logger.warn(`[wifi-opt] sweep drift device=${d.id} falhou: ${String(err)}`),
      );
    }
  }

  // ───────────────────────────── helpers ────────────────────────────────────

  /** Auditoria append-only (padrão ProvisioningService.persistEvent, com
   *  actorKind explícito — o sweeper roda como "cron", o bus como "system"). */
  private async persistEvent(opts: {
    tenantId: string;
    contractId: string | null;
    ontId: string | null;
    oltId: string | null;
    status: ProvisioningEventStatus;
    payload?: Prisma.JsonValue;
    error?: string | null;
    actorUserId?: string | null;
    actorKind?: string;
  }): Promise<void> {
    await this.prisma.provisioningEvent.create({
      data: {
        tenantId: opts.tenantId,
        contractId: opts.contractId,
        ontId: opts.ontId,
        oltId: opts.oltId,
        action: 'TR069_WIFI_OPT',
        status: opts.status,
        payload: (opts.payload ?? null) as Prisma.InputJsonValue,
        error: opts.error ?? null,
        actorUserId: opts.actorUserId ?? null,
        actorKind: opts.actorKind ?? (opts.actorUserId ? 'user' : 'system'),
      },
    });
  }
}
