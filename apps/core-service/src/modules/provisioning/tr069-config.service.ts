/**
 * Tr069ConfigService — políticas TR-069 por instância (por tenant) + caixa de
 * adoção de ONTs desconhecidas.
 *
 * Padrão EfiConfig: segredo (senha de acesso) cifrado via CryptoService,
 * write-only na API. Os consumidores de runtime (reconcile/diagnostics) leem a
 * config efetiva com fallback pros defaults de env — sem regressão.
 *
 * @provenance Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=
 */
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type {
  AdoptPendingDeviceRequest,
  Tr069ConfigResponse,
  Tr069PendingDeviceDto,
  UpsertTr069ConfigRequest,
} from '@netx/shared';
import type { Tr069TenantConfig } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import { CryptoService } from '../crypto/crypto.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class Tr069ConfigService {
  private readonly logger = new Logger(Tr069ConfigService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
  ) {}

  // ── Config ────────────────────────────────────────────────────────────────

  async get(tenantId: string): Promise<Tr069ConfigResponse> {
    const cfg = await this.prisma.tr069TenantConfig.findUnique({ where: { tenantId } });
    return this.toResponse(tenantId, cfg);
  }

  /** Linha bruta (uso interno: reconcile/diagnostics/provisionamento). */
  getRaw(tenantId: string): Promise<Tr069TenantConfig | null> {
    return this.prisma.tr069TenantConfig.findUnique({ where: { tenantId } });
  }

  /** Senha de acesso padrão decifrada (null se não definida). Uso interno. */
  decryptAccessPassword(cfg: Tr069TenantConfig | null): string | null {
    if (!cfg?.accessPasswordEnc) return null;
    return this.crypto.decrypt(cfg.accessPasswordEnc);
  }

  async upsert(
    tenantId: string,
    actorUserId: string,
    input: UpsertTr069ConfigRequest,
  ): Promise<Tr069ConfigResponse> {
    const existing = await this.getRaw(tenantId);

    // Senha de acesso: write-only — só sobrescreve com valor não-vazio.
    let accessPasswordEnc = existing?.accessPasswordEnc ?? null;
    if (input.accessPassword !== undefined && input.accessPassword !== '') {
      accessPasswordEnc = this.crypto.encrypt(input.accessPassword);
    }

    const pick = <K extends keyof Tr069TenantConfig>(
      key: K,
      val: unknown,
      fallback: Tr069TenantConfig[K],
    ): Tr069TenantConfig[K] =>
      (val !== undefined ? (val as Tr069TenantConfig[K]) : (existing?.[key] ?? fallback));

    const data = {
      acceptUnknownInforms: pick('acceptUnknownInforms', input.acceptUnknownInforms, false),
      wifiFromContract: pick('wifiFromContract', input.wifiFromContract, true),
      pppoeSource: pick('pppoeSource', input.pppoeSource, 'CONTRACT'),
      defaultVlan: input.defaultVlan !== undefined ? input.defaultVlan : (existing?.defaultVlan ?? null),
      pullFromOltProvisioning: pick(
        'pullFromOltProvisioning',
        input.pullFromOltProvisioning,
        false,
      ),
      ipv6Enabled: pick('ipv6Enabled', input.ipv6Enabled, true),
      ipv6Mode: pick('ipv6Mode', input.ipv6Mode, 'AUTOCONFIGURED'),
      accessPasswordEnc,
      applyAccessPassword: pick('applyAccessPassword', input.applyAccessPassword, false),
      remoteHttpEnabled: pick('remoteHttpEnabled', input.remoteHttpEnabled, false),
      remoteHttpPort:
        input.remoteHttpPort !== undefined ? input.remoteHttpPort : (existing?.remoteHttpPort ?? null),
      remoteMode: pick('remoteMode', input.remoteMode, 'LAN_ONLY'),
      firmwareAutoUpdate: pick('firmwareAutoUpdate', input.firmwareAutoUpdate, false),
      firmwareUrl: input.firmwareUrl !== undefined ? input.firmwareUrl : (existing?.firmwareUrl ?? null),
      firmwareTargetVersion:
        input.firmwareTargetVersion !== undefined
          ? input.firmwareTargetVersion
          : (existing?.firmwareTargetVersion ?? null),
      reconcileIntervalMin:
        input.reconcileIntervalMin !== undefined
          ? input.reconcileIntervalMin
          : (existing?.reconcileIntervalMin ?? null),
      reconcileWindowStart:
        input.reconcileWindowStart !== undefined
          ? input.reconcileWindowStart
          : (existing?.reconcileWindowStart ?? null),
      reconcileWindowEnd:
        input.reconcileWindowEnd !== undefined
          ? input.reconcileWindowEnd
          : (existing?.reconcileWindowEnd ?? null),
      // WiFi-Opt (pacote de otimização Wi-Fi Huawei — flags per-tenant do
      // duplo opt-in; a env global fica no WifiOptService).
      wifiOptEnabled: pick('wifiOptEnabled', input.wifiOptEnabled, false),
      wifiOptRegDomain: pick('wifiOptRegDomain', input.wifiOptRegDomain, 'PY'),
      wifiOptRolloutEnabled: pick('wifiOptRolloutEnabled', input.wifiOptRolloutEnabled, false),
    };

    const saved = await this.prisma.tr069TenantConfig.upsert({
      where: { tenantId },
      create: { tenantId, ...data },
      update: data,
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'tr069.config.upsert',
      resource: 'Tr069TenantConfig',
      resourceId: saved.id,
      metadata: { accessPasswordChanged: accessPasswordEnc !== (existing?.accessPasswordEnc ?? null) },
    });

    return this.toResponse(tenantId, saved);
  }

  private toResponse(tenantId: string, c: Tr069TenantConfig | null): Tr069ConfigResponse {
    return {
      tenantId,
      acceptUnknownInforms: c?.acceptUnknownInforms ?? false,
      wifiFromContract: c?.wifiFromContract ?? true,
      pppoeSource: (c?.pppoeSource ?? 'CONTRACT') as Tr069ConfigResponse['pppoeSource'],
      defaultVlan: c?.defaultVlan ?? null,
      pullFromOltProvisioning: c?.pullFromOltProvisioning ?? false,
      ipv6Enabled: c?.ipv6Enabled ?? true,
      ipv6Mode: (c?.ipv6Mode ?? 'AUTOCONFIGURED') as Tr069ConfigResponse['ipv6Mode'],
      hasAccessPassword: !!c?.accessPasswordEnc,
      applyAccessPassword: c?.applyAccessPassword ?? false,
      remoteHttpEnabled: c?.remoteHttpEnabled ?? false,
      remoteHttpPort: c?.remoteHttpPort ?? null,
      remoteMode: (c?.remoteMode ?? 'LAN_ONLY') as Tr069ConfigResponse['remoteMode'],
      firmwareAutoUpdate: c?.firmwareAutoUpdate ?? false,
      firmwareUrl: c?.firmwareUrl ?? null,
      firmwareTargetVersion: c?.firmwareTargetVersion ?? null,
      reconcileIntervalMin: c?.reconcileIntervalMin ?? null,
      reconcileWindowStart: c?.reconcileWindowStart ?? null,
      reconcileWindowEnd: c?.reconcileWindowEnd ?? null,
      wifiOptEnabled: c?.wifiOptEnabled ?? false,
      wifiOptRegDomain: c?.wifiOptRegDomain ?? 'PY',
      wifiOptRolloutEnabled: c?.wifiOptRolloutEnabled ?? false,
      createdAt: c?.createdAt?.toISOString() ?? null,
      updatedAt: c?.updatedAt?.toISOString() ?? null,
    };
  }

  // ── Caixa de adoção ─────────────────────────────────────────────────────────

  /** Pendentes de adoção (tenantless — CPE desconhecido que informou). */
  async listPending(): Promise<Tr069PendingDeviceDto[]> {
    const rows = await this.prisma.tr069PendingDevice.findMany({
      orderBy: { lastSeenAt: 'desc' },
      take: 200,
    });
    return rows.map((r) => ({
      id: r.id,
      deviceId: r.deviceId,
      manufacturer: r.manufacturer,
      productClass: r.productClass,
      serialNumber: r.serialNumber,
      softwareVersion: r.softwareVersion,
      informCount: r.informCount,
      firstSeenAt: r.firstSeenAt.toISOString(),
      lastSeenAt: r.lastSeenAt.toISOString(),
    }));
  }

  /**
   * Adota um pendente: cria o tr069_devices no tenant (opcionalmente vinculado a
   * uma ONT) e remove da caixa. O próximo Inform atualiza pra ONLINE.
   */
  async adopt(
    tenantId: string,
    actorUserId: string,
    pendingId: string,
    input: AdoptPendingDeviceRequest,
  ): Promise<{ deviceId: string }> {
    const pending = await this.prisma.tr069PendingDevice.findUnique({ where: { id: pendingId } });
    if (!pending) throw new NotFoundException('pendente não encontrado');

    if (input.ontId) {
      const ont = await this.prisma.ont.findFirst({
        where: { id: input.ontId, tenantId },
        select: { id: true },
      });
      if (!ont) throw new NotFoundException('ONT não encontrada neste tenant');
    }

    const device = await this.prisma.tr069Device.upsert({
      where: { deviceId: pending.deviceId },
      update: {
        tenantId,
        ontId: input.ontId ?? null,
        manufacturer: pending.manufacturer,
        productClass: pending.productClass,
        softwareVersion: pending.softwareVersion,
        connectionRequestUrl: pending.connectionRequestUrl,
      },
      create: {
        tenantId,
        ontId: input.ontId ?? null,
        deviceId: pending.deviceId,
        manufacturer: pending.manufacturer,
        productClass: pending.productClass,
        softwareVersion: pending.softwareVersion,
        connectionRequestUrl: pending.connectionRequestUrl,
        parametersSnapshot: pending.parametersSnapshot ?? undefined,
        status: 'UNKNOWN',
      },
      select: { id: true },
    });

    await this.prisma.tr069PendingDevice.delete({ where: { id: pendingId } });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'tr069.device.adopt',
      resource: 'Tr069Device',
      resourceId: device.id,
      metadata: { pendingDeviceId: pending.deviceId, ontId: input.ontId ?? null },
    });

    return { deviceId: device.id };
  }

  // ── Campanha de firmware ────────────────────────────────────────────────────

  /**
   * Enfileira DOWNLOAD (firmware) pros devices ONLINE do tenant. Usa a URL da
   * config. Pula quem já está na versão alvo e quem já tem DOWNLOAD em curso.
   * `productClass` opcional restringe ao modelo (recomendado — firmware é por
   * modelo). Sem filtro, atinge todos os ONLINE (use com cautela).
   */
  async runFirmwareCampaign(
    tenantId: string,
    actorUserId: string,
    filter?: { productClass?: string | null },
  ): Promise<{ enqueued: number }> {
    const cfg = await this.getRaw(tenantId);
    if (!cfg?.firmwareUrl) {
      throw new BadRequestException('Configure a URL do firmware antes de rodar a campanha');
    }
    const devices = await this.prisma.tr069Device.findMany({
      where: {
        tenantId,
        status: 'ONLINE',
        ...(filter?.productClass ? { productClass: filter.productClass } : {}),
        ...(cfg.firmwareTargetVersion
          ? { NOT: { softwareVersion: cfg.firmwareTargetVersion } }
          : {}),
      },
      select: { id: true },
    });
    let enqueued = 0;
    for (const d of devices) {
      const inflight = await this.prisma.tr069Task.count({
        where: { deviceId: d.id, action: 'DOWNLOAD', status: { in: ['PENDING', 'RUNNING'] } },
      });
      if (inflight > 0) continue;
      await this.prisma.tr069Task.create({
        data: {
          tenantId,
          deviceId: d.id,
          action: 'DOWNLOAD',
          payload: {
            url: cfg.firmwareUrl,
            fileType: '1 Firmware Upgrade Image',
            purpose: 'CAMPAIGN',
          },
          status: 'PENDING',
        },
      });
      enqueued++;
    }
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'tr069.firmware.campaign',
      resource: 'Tr069TenantConfig',
      resourceId: tenantId,
      metadata: { enqueued, productClass: filter?.productClass ?? null },
    });
    this.logger.log(`[tr069] campanha de firmware tenant=${tenantId} enfileirou ${enqueued} device(s)`);
    return { enqueued };
  }
}
