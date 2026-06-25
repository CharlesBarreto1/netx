/**
 * Tr069ReconcileService — motor de conformidade (desired-state / drift).
 *
 * A cada ciclo, pra cada device ONLINE "due":
 *   1. Resolve o profile homologado por (manufacturer, productClass, firmware).
 *   2. Computa os valores ESPERADOS das regras (estático + derivado do contrato).
 *   3. Lê os valores ATUAIS do último GET de reconciliação (purpose=RECONCILE)
 *      — se faltam/estão velhos, enfileira um GET e espera o próximo ciclo
 *      ("medir → agir → re-medir").
 *   4. Diff:
 *      - REPORT_ONLY → registra Tr069Drift, não escreve.
 *      - ENFORCE live → SET imediato (agrupado), drift=REMEDIATING.
 *      - ENFORCE requiresReboot → SET (config staged) + drift=PENDING_REBOOT
 *        (NÃO reinicia no dia-a-dia — Fase 3 cuida do reboot agendado).
 *   5. Atualiza complianceStatus do device.
 *
 * Decisões travadas (jun/2026): auto-enforce; reboot deferido; WiFi é do sistema.
 *
 * @provenance Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=
 */
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type {
  Tr069ComplianceStatus,
  Tr069Drift,
  Tr069DriftStatus,
  Tr069ProfileRule,
  Tr069TenantConfig,
  WifiBandMode,
} from '@prisma/client';

import { CryptoService } from '../crypto/crypto.service';
import { PrismaService } from '../prisma/prisma.service';
import { ssid5gFor } from './tr069-paths.huawei';

const ENABLED = (process.env.TR069_RECONCILE_ENABLED ?? '1') !== '0';
/** Reconcilia cada device no máximo a cada N min (throttle do cron). */
const INTERVAL_MIN = parseInt(process.env.TR069_RECONCILE_INTERVAL_MIN ?? '10', 10);
/** Um GET de reconciliação mais velho que isto é considerado stale (re-GET). */
const GET_FRESH_MIN = parseInt(process.env.TR069_RECONCILE_GET_FRESH_MIN ?? '15', 10);
/** Devices processados por tick do cron. */
const BATCH = parseInt(process.env.TR069_RECONCILE_BATCH ?? '100', 10);
/** Tentativas de remediação live até marcar a regra como FAILED. */
const MAX_ATTEMPTS = parseInt(process.env.TR069_RECONCILE_MAX_ATTEMPTS ?? '5', 10);

const ACTIVE_DRIFT: Tr069DriftStatus[] = ['OPEN', 'REMEDIATING', 'PENDING_REBOOT'];

// ── Agendador de reboot (Fase 3) — OPT-IN, desligado por padrão ─────────────
/** Liga o reboot automático de devices PENDING_REBOOT na janela de madrugada. */
const AUTO_REBOOT = (process.env.TR069_AUTO_REBOOT_ENABLED ?? '0') === '1';
/** Janela de manutenção (hora local do tenant). Default 03:00–05:00. */
const REBOOT_WINDOW_START = parseInt(process.env.TR069_REBOOT_WINDOW_START ?? '3', 10);
const REBOOT_WINDOW_END = parseInt(process.env.TR069_REBOOT_WINDOW_END ?? '5', 10);
/** Não reinicia o mesmo device de novo dentro deste período (h). */
const REBOOT_COOLDOWN_H = parseInt(process.env.TR069_REBOOT_COOLDOWN_H ?? '12', 10);

type DeviceForReconcile = {
  id: string;
  tenantId: string;
  manufacturer: string | null;
  oui: string | null;
  productClass: string | null;
  softwareVersion: string | null;
  profileId: string | null;
  complianceStatus: Tr069ComplianceStatus;
  pendingRebootSince: Date | null;
  lastReconciledAt: Date | null;
  tenant: { timezone: string } | null;
  ont: {
    wifiBandMode: WifiBandMode;
    contract: {
      pppoeUsername: string | null;
      pppoePassword: string | null;
      ssid: string | null;
      wifiPasswordEnc: string | null;
    } | null;
  } | null;
};

@Injectable()
export class Tr069ReconcileService {
  private readonly logger = new Logger(Tr069ReconcileService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  /** Cron: varre devices ONLINE "due" e reconcilia. */
  @Cron(CronExpression.EVERY_MINUTE)
  async reconcileDue(): Promise<void> {
    if (!ENABLED) return;
    const cutoff = new Date(Date.now() - INTERVAL_MIN * 60_000);
    const devices = await this.prisma.tr069Device.findMany({
      where: {
        status: 'ONLINE',
        OR: [{ lastReconciledAt: null }, { lastReconciledAt: { lt: cutoff } }],
      },
      select: { id: true },
      orderBy: { lastReconciledAt: { sort: 'asc', nulls: 'first' } },
      take: BATCH,
    });
    for (const d of devices) {
      await this.reconcileDevice(d.id).catch((err: unknown) =>
        this.logger.error(`[reconcile] device=${d.id} falhou: ${String(err)}`),
      );
    }
  }

  /**
   * Agendador de reboot deferido (Fase 3). OPT-IN: só roda se
   * TR069_AUTO_REBOOT_ENABLED=1. Na janela de madrugada (hora local do tenant),
   * reinicia devices em PENDING_REBOOT que não foram reiniciados recentemente.
   * Mecanismo: REBOOT TR-069 (aplica no próximo Inform/CR). Reboot via OLT é
   * evolução futura (driver não expõe hoje). O reboot manual do painel é o
   * caminho primário enquanto isto fica desligado.
   */
  @Cron(CronExpression.EVERY_30_MINUTES)
  async rebootScheduler(): Promise<void> {
    if (!ENABLED || !AUTO_REBOOT) return;
    const candidates = await this.prisma.tr069Device.findMany({
      where: { status: 'ONLINE', complianceStatus: 'PENDING_REBOOT' },
      select: { id: true, tenantId: true, tenant: { select: { timezone: true } } },
      take: BATCH,
    });
    const since = new Date(Date.now() - REBOOT_COOLDOWN_H * 3_600_000);
    for (const d of candidates) {
      if (!this.inRebootWindow(d.tenant?.timezone ?? 'UTC')) continue;
      const recent = await this.prisma.tr069Task.count({
        where: { deviceId: d.id, action: 'REBOOT', createdAt: { gte: since } },
      });
      if (recent > 0) continue; // cooldown — já reiniciado há pouco
      await this.prisma.tr069Task.create({
        data: {
          tenantId: d.tenantId,
          deviceId: d.id,
          action: 'REBOOT',
          payload: { purpose: 'RECONCILE_REBOOT' },
          status: 'PENDING',
        },
      });
      this.logger.log(`[reboot-scheduler] REBOOT agendado device=${d.id}`);
    }
  }

  /** Hora local do tenant está dentro da janela de reboot? */
  private inRebootWindow(timezone: string): boolean {
    return this.inHourWindow(timezone, REBOOT_WINDOW_START, REBOOT_WINDOW_END);
  }

  /** Hora local do tenant está em [start, end) (suporta janela que cruza meia-noite)? */
  private inHourWindow(timezone: string, start: number, end: number): boolean {
    try {
      const h = parseInt(
        new Intl.DateTimeFormat('en-US', {
          timeZone: timezone,
          hour: '2-digit',
          hour12: false,
        }).format(new Date()),
        10,
      );
      return start <= end ? h >= start && h < end : h >= start || h < end;
    } catch {
      return false;
    }
  }

  /**
   * Reconcilia um device. `force` (reconcile manual do portal) ignora os gates
   * de intervalo/janela por-tenant; o cron passa force=false (respeita a config).
   */
  async reconcileDevice(deviceId: string, opts?: { force?: boolean }): Promise<void> {
    const force = opts?.force ?? false;
    const device = (await this.prisma.tr069Device.findUnique({
      where: { id: deviceId },
      select: {
        id: true,
        tenantId: true,
        manufacturer: true,
        oui: true,
        productClass: true,
        softwareVersion: true,
        profileId: true,
        complianceStatus: true,
        pendingRebootSince: true,
        lastReconciledAt: true,
        tenant: { select: { timezone: true } },
        ont: {
          select: {
            wifiBandMode: true,
            contract: {
              select: {
                pppoeUsername: true,
                pppoePassword: true,
                ssid: true,
                wifiPasswordEnc: true,
              },
            },
          },
        },
      },
    })) as DeviceForReconcile | null;
    if (!device) return;

    // Config de políticas do tenant (intervalo/janela/senha/wifi/VLAN).
    const cfg = await this.prisma.tr069TenantConfig.findUnique({
      where: { tenantId: device.tenantId },
    });

    // Gates por-tenant (ignorados no reconcile manual `force`):
    //  - intervalo: respeita um intervalo próprio MAIOR que o global do cron;
    //  - janela: conformidade (alterações) só roda na faixa horária local.
    if (!force && cfg) {
      if (
        cfg.reconcileIntervalMin != null &&
        device.lastReconciledAt != null &&
        Date.now() - device.lastReconciledAt.getTime() < cfg.reconcileIntervalMin * 60_000
      ) {
        return;
      }
      if (
        cfg.reconcileWindowStart != null &&
        cfg.reconcileWindowEnd != null &&
        !this.inHourWindow(
          device.tenant?.timezone ?? 'UTC',
          cfg.reconcileWindowStart,
          cfg.reconcileWindowEnd,
        )
      ) {
        return;
      }
    }

    // 1. Profile homologado
    const profile = await this.resolveProfile(device);
    if (!profile) {
      await this.markCompliance(device, 'UNKNOWN', null, null);
      return;
    }
    if (device.profileId !== profile.id) {
      await this.prisma.tr069Device.update({
        where: { id: device.id },
        data: { profileId: profile.id },
      });
    }
    const rules = profile.rules.filter((r) => r.enabled);
    if (rules.length === 0) {
      await this.markCompliance(device, 'COMPLIANT', profile.id, profile.version);
      return;
    }

    // Remediação/medição em andamento? Não re-avalia — evita pile-up e contar
    // tentativas antes de o CPE aplicar o SET e reportar no GET seguinte.
    const inFlight = await this.prisma.tr069Task.count({
      where: {
        deviceId: device.id,
        status: { in: ['PENDING', 'RUNNING'] },
        payload: { path: ['purpose'], equals: 'RECONCILE' },
      },
    });
    if (inFlight > 0) return;

    // 2. Valores esperados — a config do tenant (carregada acima: senha de
    // acesso, wifi-do-contrato, VLAN padrão) influencia a resolução.
    const expected = new Map<string, string | null>();
    for (const r of rules) expected.set(r.param, this.resolveExpected(r, device, cfg));

    // 3. Valores atuais — último GET de reconciliação DONE e fresco.
    const paramNames = rules.map((r) => r.param);
    const actual = await this.readActual(device.id);
    if (!actual) {
      // Sem leitura fresca: mede e espera o próximo ciclo (medir → agir → re-medir).
      // Mantém PENDING_REBOOT (não regride pra UNKNOWN enquanto aguarda o boot).
      await this.ensureReconcileGet(device.tenantId, device.id, paramNames);
      const waiting =
        device.complianceStatus === 'PENDING_REBOOT' ? 'PENDING_REBOOT' : 'UNKNOWN';
      await this.markCompliance(device, waiting, profile.id, profile.version);
      return;
    }
    // Params ausentes do GET fresco são não-legíveis (write-only, ex.: senhas/
    // PreSharedKey, ou fora do firmware) — pulados no diff, não travam a
    // conformidade nem geram loop de SET.

    // drifts ativos/FAILED do device, indexados por param (anti-loop)
    const existingDrifts = await this.prisma.tr069Drift.findMany({
      where: { deviceId: device.id, status: { in: [...ACTIVE_DRIFT, 'FAILED'] } },
    });
    const driftByParam = new Map(existingDrifts.map((d) => [d.param, d]));

    // 4. Diff + remediação
    const setParams: Array<{ name: string; value: string; type: string }> = [];
    let needReboot = false;
    let driftedCount = 0;

    for (const r of rules) {
      const exp = expected.get(r.param) ?? null;
      if (exp == null) continue; // não resolvido (ex.: contrato sem dado) — pula
      if (!(r.param in actual)) continue; // não-legível neste firmware — pula
      const act = actual[r.param];
      const prev = driftByParam.get(r.param);

      if (act === exp) {
        if (prev && prev.status !== 'RESOLVED') await this.resolveDrift(prev.id);
        continue;
      }

      driftedCount++;

      if (r.mode === 'REPORT_ONLY') {
        await this.upsertDrift(device, r, exp, act, 'OPEN', prev);
        continue;
      }

      // ENFORCE — se já estourou as tentativas, não fica num loop de SET.
      if (prev?.status === 'FAILED') {
        await this.touchDrift(prev.id, exp, act);
        continue;
      }

      if (r.requiresReboot) {
        needReboot = true;
        // Já staged aguardando reboot? Não re-enfileira o SET todo ciclo.
        if (prev?.status === 'PENDING_REBOOT') {
          await this.touchDrift(prev.id, exp, act);
          continue;
        }
        setParams.push({ name: r.param, value: exp, type: r.valueType });
        await this.upsertDrift(device, r, exp, act, 'PENDING_REBOOT', prev);
        continue;
      }

      setParams.push({ name: r.param, value: exp, type: r.valueType });
      await this.upsertDrift(device, r, exp, act, 'REMEDIATING', prev);
    }

    // Enfileira UM SET com todos os params live/staged + re-mede no próximo ciclo
    if (setParams.length > 0) {
      await this.prisma.tr069Task.create({
        data: {
          tenantId: device.tenantId,
          deviceId: device.id,
          action: 'SET_PARAMS',
          payload: { params: setParams, purpose: 'RECONCILE' },
          status: 'PENDING',
        },
      });
      await this.ensureReconcileGet(device.tenantId, device.id, paramNames);
      this.logger.log(
        `[reconcile] device=${device.id} enforce ${setParams.length} param(s)` +
          (needReboot ? ' (aguarda reboot)' : ''),
      );
    }

    const status: Tr069ComplianceStatus = needReboot
      ? 'PENDING_REBOOT'
      : setParams.length > 0
        ? 'REMEDIATING'
        : driftedCount > 0
          ? 'DRIFTED'
          : 'COMPLIANT';
    await this.markCompliance(device, status, profile.id, profile.version);
  }

  // ───────────────────────────── helpers ────────────────────────────────────

  /** Acha o profile ativo mais específico pro device (productClass > curinga). */
  private async resolveProfile(device: DeviceForReconcile) {
    // Fabricante efetivo: o reportado no Inform, ou inferido pelo OUI
    // (00259E = Huawei) quando o CPE não preenche manufacturer. Match é
    // tolerante (case-insensitive "contém") porque o Huawei reporta
    // "Huawei Technologies Co., Ltd." e o profile guarda só "Huawei".
    const devMan = (
      device.manufacturer ?? (device.oui === '00259E' ? 'Huawei' : '')
    ).toLowerCase();
    if (!devMan) return null;
    const candidates = await this.prisma.tr069Profile.findMany({
      where: { tenantId: device.tenantId, active: true },
      include: { rules: true },
    });
    const matched = candidates.filter(
      (p) =>
        devMan.includes(p.manufacturer.toLowerCase()) &&
        (p.productClass == null || p.productClass === device.productClass) &&
        this.firmwareMatches(p.firmwarePattern, device.softwareVersion),
    );
    // Mais específico primeiro: productClass setado > curinga; depois maior versão.
    matched.sort(
      (a, b) => (b.productClass ? 1 : 0) - (a.productClass ? 1 : 0) || b.version - a.version,
    );
    return matched[0] ?? null;
  }

  private firmwareMatches(pattern: string | null, sw: string | null): boolean {
    if (!pattern) return true;
    if (!sw) return false;
    try {
      return new RegExp(pattern).test(sw);
    } catch {
      return sw.includes(pattern);
    }
  }

  /**
   * Valor esperado de uma regra pro device (estático / contrato / config da
   * instância). `cfg` = Tr069TenantConfig do tenant (null = defaults).
   */
  private resolveExpected(
    rule: Tr069ProfileRule,
    device: DeviceForReconcile,
    cfg: Tr069TenantConfig | null,
  ): string | null {
    const c = device.ont?.contract ?? null;
    // Wi-Fi do contrato pode ser desligado por instância (config). Off → não
    // resolve as regras CONTRACT_WIFI_* (ficam fora do enforce/drift).
    const wifiFromContract = cfg?.wifiFromContract ?? true;
    switch (rule.source) {
      case 'STATIC':
        return rule.staticValue;
      case 'CONTRACT_PPPOE_USER':
        return c?.pppoeUsername ?? null;
      case 'CONTRACT_PPPOE_PASS':
        return c?.pppoePassword ?? null;
      case 'CONTRACT_WIFI_SSID':
        return wifiFromContract ? (c?.ssid ?? null) : null;
      case 'CONTRACT_WIFI_SSID_5G':
        return wifiFromContract && c?.ssid
          ? ssid5gFor(c.ssid, device.ont?.wifiBandMode ?? 'BAND_STEERING')
          : null;
      case 'CONTRACT_WIFI_PASS':
        return wifiFromContract && c?.wifiPasswordEnc ? this.crypto.decrypt(c.wifiPasswordEnc) : null;
      case 'CONTRACT_PPPOE_VLAN':
        // VLAN padrão por instância (config); senão não resolve (use STATIC).
        return cfg?.defaultVlan != null ? String(cfg.defaultVlan) : null;
      case 'TENANT_ACCESS_PASSWORD':
        // Senha de acesso padrão da instância (cifrada). Só aplica se ligado.
        return cfg?.applyAccessPassword && cfg.accessPasswordEnc
          ? this.crypto.decrypt(cfg.accessPasswordEnc)
          : null;
      default:
        return null;
    }
  }

  /** Lê os params do último GET de reconciliação DONE (result.params). */
  private async readActual(deviceId: string): Promise<Record<string, string> | null> {
    const cutoff = new Date(Date.now() - GET_FRESH_MIN * 60_000);
    const task = await this.prisma.tr069Task.findFirst({
      where: {
        deviceId,
        action: 'GET_PARAMS',
        status: 'DONE',
        completedAt: { gte: cutoff },
        payload: { path: ['purpose'], equals: 'RECONCILE' },
      },
      orderBy: { completedAt: 'desc' },
      select: { result: true },
    });
    const result = task?.result as { params?: Record<string, string> } | null;
    return result?.params ?? null;
  }

  /** Enfileira um GET de reconciliação se não houver um PENDING (evita pileup). */
  private async ensureReconcileGet(
    tenantId: string,
    deviceId: string,
    names: string[],
  ): Promise<void> {
    const pending = await this.prisma.tr069Task.findFirst({
      where: {
        deviceId,
        action: 'GET_PARAMS',
        status: 'PENDING',
        payload: { path: ['purpose'], equals: 'RECONCILE' },
      },
      select: { id: true },
    });
    if (pending) return;
    await this.prisma.tr069Task.create({
      data: {
        tenantId,
        deviceId,
        action: 'GET_PARAMS',
        payload: { names, purpose: 'RECONCILE' },
        status: 'PENDING',
      },
    });
  }

  private async upsertDrift(
    device: DeviceForReconcile,
    rule: Tr069ProfileRule,
    expected: string | null,
    actual: string | null,
    status: Tr069DriftStatus,
    prev: Tr069Drift | undefined,
  ): Promise<void> {
    // attempts só conta remediação LIVE (REMEDIATING); PENDING_REBOOT espera boot.
    const counts = status === 'REMEDIATING';
    if (prev) {
      const attempts = counts ? prev.attempts + 1 : prev.attempts;
      const failed = counts && attempts > MAX_ATTEMPTS;
      await this.prisma.tr069Drift.update({
        where: { id: prev.id },
        data: {
          expected,
          actual,
          requiresReboot: rule.requiresReboot,
          attempts,
          status: failed ? 'FAILED' : status,
          lastSeenAt: new Date(),
        },
      });
      if (failed) {
        this.logger.warn(
          `[reconcile] device=${device.id} param=${rule.param} FAILED após ${attempts} tentativas`,
        );
      }
      return;
    }
    await this.prisma.tr069Drift.create({
      data: {
        tenantId: device.tenantId,
        deviceId: device.id,
        param: rule.param,
        expected,
        actual,
        requiresReboot: rule.requiresReboot,
        attempts: counts ? 1 : 0,
        status,
      },
    });
  }

  /** Atualiza expected/actual de um drift sem mexer no status (ex.: FAILED). */
  private async touchDrift(id: string, expected: string | null, actual: string | null) {
    await this.prisma.tr069Drift.update({
      where: { id },
      data: { expected, actual, lastSeenAt: new Date() },
    });
  }

  private async resolveDrift(id: string): Promise<void> {
    await this.prisma.tr069Drift.update({
      where: { id },
      data: { status: 'RESOLVED', resolvedAt: new Date() },
    });
  }

  private async markCompliance(
    device: DeviceForReconcile,
    status: Tr069ComplianceStatus,
    profileId: string | null,
    profileVersion: number | null,
  ): Promise<void> {
    const pendingRebootSince =
      status === 'PENDING_REBOOT' ? (device.pendingRebootSince ?? new Date()) : null;
    await this.prisma.tr069Device.update({
      where: { id: device.id },
      data: {
        complianceStatus: status,
        lastReconciledAt: new Date(),
        ...(profileId !== null ? { profileId } : {}),
        ...(profileVersion !== null ? { reconciledProfileVersion: profileVersion } : {}),
        pendingRebootSince,
      },
    });
  }
}
