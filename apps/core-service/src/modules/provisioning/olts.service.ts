/**
 * OltsService — CRUD de OLTs + testConnection via driver.
 *
 * Responsabilidades:
 *   - Persistir Olt rows (com criptografia at-rest de senha SSH / API creds)
 *   - Testar conexão via driver (DIRECT: SSH handshake / ORCHESTRATOR: API ping)
 *   - Validar consistência providerMode ↔ campos (DTO já valida mas service
 *     defende contra updates parciais que violariam invariante)
 *
 * NÃO faz provisioning real — isso é responsabilidade do ProvisioningService.
 *
 * @provenance Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=
 */
import { execFile } from 'node:child_process';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  type CreateOltRequest,
  type ListOltsQuery,
  type OltResponse,
  type Paginated,
  paginationMeta,
  type UpdateOltRequest,
} from '@netx/shared';
import { Prisma } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import { CryptoService } from '../crypto/crypto.service';
import { PrismaService } from '../prisma/prisma.service';

import { UfinetOrdersService } from '../ufinet/ufinet-orders.service';

import { OltDriverFactory } from './drivers/olt-driver.factory';
import { buildConnectionContext } from './olt-context.util';

type OltRow = Prisma.OltGetPayload<{
  include: {
    pop: { select: { id: true; name: true; code: true } };
    defaultProvisioningProfile: { select: { id: true; name: true } };
    _count: { select: { onts: true } };
  };
}>;

// Include padrão pra todas as leituras de OLT — pop + contagem de ONTs.
const OLT_INCLUDE = {
  pop: { select: { id: true, name: true, code: true } },
  defaultProvisioningProfile: { select: { id: true, name: true } },
  _count: { select: { onts: true } },
} as const;

function toResponse(o: OltRow): OltResponse {
  return {
    id: o.id,
    tenantId: o.tenantId,
    name: o.name,
    vendor: o.vendor,
    model: o.model,
    providerMode: o.providerMode,
    managementIp: o.managementIp,
    sshPort: o.sshPort,
    sshUser: o.sshUser,
    hasSshPassword: !!o.sshPasswordEnc,
    hasEnableSecret: !!o.enableSecretEnc,
    apiEndpoint: o.apiEndpoint,
    apiAuthType: (o.apiAuthType as 'OAUTH2' | 'API_KEY' | 'MTLS' | null) ?? null,
    hasApiCredentials: !!o.apiCredentialsEnc,
    hasApiWebhookSecret: !!o.apiWebhookSecret,
    apiConfig: (o.apiConfig as Record<string, unknown> | null) ?? null,
    serviceVlanId: o.serviceVlanId,
    defaultUpProfile: o.defaultUpProfile,
    defaultDownProfile: o.defaultDownProfile,
    defaultProvisioningProfileId: o.defaultProvisioningProfileId,
    defaultProvisioningProfileName: o.defaultProvisioningProfile?.name ?? null,
    status: o.status,
    lastSeenAt: o.lastSeenAt?.toISOString() ?? null,
    lastError: o.lastError,
    latitude: o.latitude != null ? Number(o.latitude) : null,
    longitude: o.longitude != null ? Number(o.longitude) : null,
    popId: o.popId,
    pop: o.pop,
    ontsCount: o._count?.onts ?? 0,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
  };
}

@Injectable()
export class OltsService {
  private readonly logger = new Logger(OltsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly drivers: OltDriverFactory,
    private readonly ufinet: UfinetOrdersService,
  ) {}

  async create(
    tenantId: string,
    actorUserId: string,
    input: CreateOltRequest,
  ): Promise<OltResponse> {
    try {
      const created = await this.prisma.olt.create({
        data: {
          tenantId,
          name: input.name,
          vendor: input.vendor,
          model: input.model,
          providerMode: input.providerMode,
          managementIp: input.managementIp ?? null,
          sshPort: input.sshPort,
          sshUser: input.sshUser ?? null,
          sshPasswordEnc: this.crypto.encryptOptional(input.sshPassword ?? null),
          enableSecretEnc: this.crypto.encryptOptional(input.enableSecret ?? null),
          apiEndpoint: input.apiEndpoint ?? null,
          apiAuthType: input.apiAuthType ?? null,
          apiCredentialsEnc: input.apiCredentials
            ? this.crypto.encrypt(JSON.stringify(input.apiCredentials))
            : null,
          apiWebhookSecret: input.apiWebhookSecret ?? null,
          apiConfig:
            input.apiConfig == null
              ? Prisma.DbNull
              : (input.apiConfig as Prisma.InputJsonValue),
          serviceVlanId: input.serviceVlanId ?? null,
          defaultUpProfile: input.defaultUpProfile ?? null,
          defaultDownProfile: input.defaultDownProfile ?? null,
          defaultProvisioningProfileId: input.defaultProvisioningProfileId ?? null,
          latitude: input.latitude ?? null,
          longitude: input.longitude ?? null,
          popId: input.popId ?? null,
        },
        include: OLT_INCLUDE,
      });
      await this.audit.log({
        tenantId,
        userId: actorUserId,
        action: 'olts.created',
        resource: 'olts',
        resourceId: created.id,
      });
      // Fase 3: aponta syslog/NTP da OLT pros endpoints do NetX. Best-effort,
      // fora do caminho da resposta (segue o padrão `void syncInfra()`).
      void this.applyOltBaseline(created);
      return toResponse(created);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Já existe uma OLT com esse nome');
      }
      throw err;
    }
  }

  async list(tenantId: string, q: ListOltsQuery): Promise<Paginated<OltResponse>> {
    const where: Prisma.OltWhereInput = {
      tenantId,
      deletedAt: null,
      ...(q.vendor && { vendor: q.vendor }),
      ...(q.status && { status: q.status }),
      ...(q.popId === 'none'
        ? { popId: null }
        : q.popId
          ? { popId: q.popId }
          : {}),
      ...(q.search && {
        OR: [
          { name: { contains: q.search, mode: 'insensitive' } },
          { model: { contains: q.search, mode: 'insensitive' } },
          { managementIp: { contains: q.search } },
        ],
      }),
    };
    const skip = (q.page - 1) * q.pageSize;
    const [rows, total] = await Promise.all([
      this.prisma.olt.findMany({
        where,
        orderBy: { name: 'asc' },
        skip,
        take: q.pageSize,
        include: OLT_INCLUDE,
      }),
      this.prisma.olt.count({ where }),
    ]);
    return {
      data: rows.map(toResponse),
      pagination: paginationMeta(total, q.page, q.pageSize),
    };
  }

  async findById(tenantId: string, id: string): Promise<OltResponse> {
    const row = await this.prisma.olt.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: OLT_INCLUDE,
    });
    if (!row) throw new NotFoundException('OLT não encontrada');
    return toResponse(row);
  }

  async update(
    tenantId: string,
    actorUserId: string,
    id: string,
    input: UpdateOltRequest,
  ): Promise<OltResponse> {
    const existing = await this.prisma.olt.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('OLT não encontrada');

    // Coerência providerMode + campos obrigatórios pós-update
    const targetMode = input.providerMode ?? existing.providerMode;
    const willHaveIp = input.managementIp ?? existing.managementIp;
    const willHaveSshUser = input.sshUser ?? existing.sshUser;
    const willHaveApiEndpoint = input.apiEndpoint ?? existing.apiEndpoint;
    if (targetMode === 'DIRECT' && (!willHaveIp || !willHaveSshUser)) {
      throw new BadRequestException(
        'OLT em DIRECT mode exige managementIp e sshUser preenchidos',
      );
    }
    if (targetMode === 'ORCHESTRATOR' && !willHaveApiEndpoint) {
      throw new BadRequestException(
        'OLT em ORCHESTRATOR mode exige apiEndpoint preenchido',
      );
    }

    const data: Prisma.OltUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.vendor !== undefined) data.vendor = input.vendor;
    if (input.model !== undefined) data.model = input.model;
    if (input.providerMode !== undefined) data.providerMode = input.providerMode;
    if (input.managementIp !== undefined) data.managementIp = input.managementIp ?? null;
    if (input.sshPort !== undefined) data.sshPort = input.sshPort;
    if (input.sshUser !== undefined) data.sshUser = input.sshUser ?? null;
    if (input.sshPassword !== undefined) {
      data.sshPasswordEnc = this.crypto.encryptOptional(input.sshPassword ?? null);
    }
    if (input.enableSecret !== undefined) {
      data.enableSecretEnc = this.crypto.encryptOptional(input.enableSecret ?? null);
    }
    if (input.apiEndpoint !== undefined) data.apiEndpoint = input.apiEndpoint ?? null;
    if (input.apiAuthType !== undefined) data.apiAuthType = input.apiAuthType ?? null;
    if (input.apiCredentials !== undefined) {
      data.apiCredentialsEnc = input.apiCredentials
        ? this.crypto.encrypt(JSON.stringify(input.apiCredentials))
        : null;
    }
    if (input.apiWebhookSecret !== undefined)
      data.apiWebhookSecret = input.apiWebhookSecret ?? null;
    if (input.apiConfig !== undefined) {
      data.apiConfig =
        input.apiConfig == null ? Prisma.DbNull : (input.apiConfig as Prisma.InputJsonValue);
    }
    if (input.serviceVlanId !== undefined) data.serviceVlanId = input.serviceVlanId ?? null;
    if (input.defaultUpProfile !== undefined)
      data.defaultUpProfile = input.defaultUpProfile ?? null;
    if (input.defaultDownProfile !== undefined)
      data.defaultDownProfile = input.defaultDownProfile ?? null;
    if (input.defaultProvisioningProfileId !== undefined) {
      data.defaultProvisioningProfile = input.defaultProvisioningProfileId
        ? { connect: { id: input.defaultProvisioningProfileId } }
        : { disconnect: true };
    }
    if (input.latitude !== undefined) data.latitude = input.latitude ?? null;
    if (input.longitude !== undefined) data.longitude = input.longitude ?? null;
    // Pop usa relação Prisma (não popId direto). connect = vincular,
    // disconnect = desvincular.
    if (input.popId !== undefined) {
      data.pop = input.popId
        ? { connect: { id: input.popId } }
        : { disconnect: true };
    }

    const updated = await this.prisma.olt.update({
      where: { id },
      data,
      include: OLT_INCLUDE,
    });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'olts.updated',
      resource: 'olts',
      resourceId: id,
    });
    void this.applyOltBaseline(updated);
    return toResponse(updated);
  }

  /**
   * Fase 3 — aponta syslog + NTP da OLT pros endpoints do NetX, lendo os
   * destinos do ambiente (NETX_OLT_SYSLOG_HOST / NETX_OLT_NTP_SERVER /
   * NETX_OLT_TIMEZONE). Só roda em OLT DIRECT cujo driver implementa o
   * baseline e quando há ao menos um endpoint configurado. NUNCA propaga erro
   * (best-effort): a OLT já foi salva; falha aqui só vira log + lastError.
   */
  private async applyOltBaseline(olt: OltRow): Promise<void> {
    try {
      if (olt.providerMode !== 'DIRECT') return;

      // 1. Allowlist do NetX (chrony NTP + UFW 123/514) pra OLT alcançar o
      //    NetX. Os scripts já leem a tabela `olts`; aqui só disparamos o
      //    re-sync, igual o NetworkEquipmentService faz no cadastro de BNG.
      if (olt.managementIp) this.syncOltInfra();

      const driver = this.drivers.resolve(olt.vendor, olt.providerMode);
      if (!driver.applyManagementBaseline) return;

      // 2. Endpoints que a OLT vai apontar. NetX é o NTP (chrony local) e o
      //    coletor de syslog — ambos no mesmo IP de gerência. NETX_MANAGEMENT_IP
      //    é o default dos dois; pode sobrescrever cada um individualmente.
      const netxIp = process.env.NETX_MANAGEMENT_IP?.trim() || null;
      const syslogHost = process.env.NETX_OLT_SYSLOG_HOST?.trim() || netxIp;
      const ntpServer = process.env.NETX_OLT_NTP_SERVER?.trim() || netxIp;
      const timezone = process.env.NETX_OLT_TIMEZONE?.trim() || null;
      if (!syslogHost && !ntpServer && !timezone) return; // nada configurado

      const syslogLevelRaw = process.env.NETX_OLT_SYSLOG_LEVEL?.trim();
      const ctx = buildConnectionContext(olt, this.crypto);
      const r = await driver.applyManagementBaseline(ctx, {
        syslogHost,
        syslogLevel: syslogLevelRaw ? Number(syslogLevelRaw) : undefined,
        ntpServer,
        timezone,
      });
      if (r.success) {
        this.logger.log(
          `[olt-baseline] ${olt.name}: aplicado=[${r.data.applied.join(', ') || '∅'}] ` +
            `pulado=[${r.data.skipped.join(', ')}]`,
        );
        if (r.data.applied.length) {
          await this.prisma.olt
            .update({ where: { id: olt.id }, data: { lastError: null } })
            .catch(() => undefined);
        }
      } else {
        this.logger.warn(`[olt-baseline] ${olt.name} falhou: ${r.error}`);
        await this.prisma.olt
          .update({ where: { id: olt.id }, data: { lastError: `baseline: ${r.error}` } })
          .catch(() => undefined);
      }
    } catch (err) {
      this.logger.warn(
        `[olt-baseline] erro inesperado em ${olt.name}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * Re-sincroniza a allowlist de NTP (chrony) + UFW pra incluir as OLTs
   * DIRECT, via os mesmos scripts sudo do installer que o NetworkEquipment
   * usa pros BNGs (sync-ntp.sh + sync-firewall.sh — ambos já leem a tabela
   * `olts`). Non-blocking e best-effort: falha só loga (operador pode rodar
   * `sudo .../sync-ntp.sh` manual). Caminhos overridáveis por env.
   */
  private syncOltInfra(): void {
    const scripts = [
      process.env.NETX_SYNC_NTP_SCRIPT ?? '/opt/netx/infra/installer/scripts/sync-ntp.sh',
      process.env.NETX_SYNC_FIREWALL_SCRIPT ??
        '/opt/netx/infra/installer/scripts/sync-firewall.sh',
    ];
    for (const script of scripts) {
      execFile('sudo', ['-n', script], { timeout: 8000 }, (err, _out, stderr) => {
        if (err) {
          this.logger.warn(
            `[olt-infra-sync] ${script} falhou: ${err.message} ${stderr?.slice(0, 160) ?? ''}`,
          );
        }
      });
    }
  }

  async remove(tenantId: string, actorUserId: string, id: string): Promise<void> {
    const existing = await this.prisma.olt.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: { _count: { select: { onts: true } } },
    });
    if (!existing) throw new NotFoundException('OLT não encontrada');
    if (existing._count.onts > 0) {
      throw new ConflictException(
        `OLT tem ${existing._count.onts} ONT(s) vinculadas — desautorize antes de remover`,
      );
    }
    // Soft-delete. O device OLT do FiberMap não precisa de desvínculo aqui:
    // o índice único parcial de fibermap_devices.netx_olt_id ignora soft
    // delete, e o service do FiberMap trata OLT sem vínculo como badge
    // "re-vincular" (decisão #11 do módulo).
    await this.prisma.olt.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'olts.deleted',
      resource: 'olts',
      resourceId: id,
    });
  }

  /**
   * Migra TODAS as ONTs de uma OLT pra outra (mesma operação). É só troca de
   * vínculo LOCAL (Ont.oltId) — NUNCA chama a API da Ufinet nem toca RADIUS
   * (por pppoeUsername) ou TR-069 (por SN). Casos de uso:
   *   - rede própria (DIRECT/EXTERNAL): OLT cadastrada errada → reaponta os
   *     clientes pra OLT correta;
   *   - destino Ufinet (ORCHESTRATOR): a adoção cria o UfinetService no
   *     polígono mas deixa a Ont na OLT antiga; isto realinha a Ont com o
   *     serviço já adotado/ativo na rede neutra (não dá alta — assume que o
   *     serviço já existe lá).
   * Depois a OLT de origem fica vazia e pode ser excluída.
   */
  async migrateOnts(
    tenantId: string,
    actorUserId: string,
    sourceOltId: string,
    targetOltId: string,
  ): Promise<{ migrated: number }> {
    if (sourceOltId === targetOltId) {
      throw new BadRequestException('OLT de origem e destino não podem ser a mesma.');
    }
    const [source, target] = await Promise.all([
      this.prisma.olt.findFirst({
        where: { id: sourceOltId, tenantId, deletedAt: null },
        select: { id: true, name: true, providerMode: true },
      }),
      this.prisma.olt.findFirst({
        where: { id: targetOltId, tenantId, deletedAt: null },
        select: { id: true, name: true, providerMode: true },
      }),
    ]);
    if (!source) throw new NotFoundException('OLT de origem não encontrada');
    if (!target) throw new NotFoundException('OLT de destino não encontrada');

    const res = await this.prisma.ont.updateMany({
      where: { tenantId, oltId: sourceOltId },
      data: { oltId: targetOltId },
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'olts.onts_migrated',
      resource: 'olts',
      resourceId: sourceOltId,
      metadata: {
        targetOltId,
        targetName: target.name,
        targetMode: target.providerMode,
        migrated: res.count,
      },
    });
    return { migrated: res.count };
  }

  /**
   * Testa conexão via driver. Atualiza Olt.status + lastSeenAt + lastError.
   * Retorna o resultado bruto pra UI mostrar pro admin.
   */
  async testConnection(
    tenantId: string,
    actorUserId: string,
    id: string,
  ): Promise<{ success: boolean; message: string; durationMs: number }> {
    const olt = await this.prisma.olt.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!olt) throw new NotFoundException('OLT não encontrada');

    // UFINET/ORCHESTRATOR faz teste REAL (OAuth + GET autenticado) no módulo
    // ufinet. Demais vendors usam o driver (SSH/NoOp).
    let norm: { success: boolean; message: string; durationMs: number };
    if (olt.vendor === 'UFINET' && olt.providerMode === 'ORCHESTRATOR') {
      norm = await this.ufinet.testConnection(olt);
    } else {
      const ctx = buildConnectionContext(olt, this.crypto);
      const driver = this.drivers.resolve(olt.vendor, olt.providerMode);
      const r = await driver.testConnection(ctx);
      norm = {
        success: r.success,
        message: r.success ? r.data.message : r.error,
        durationMs: r.durationMs,
      };
    }

    await this.prisma.olt.update({
      where: { id },
      data: {
        status: norm.success ? 'ONLINE' : 'OFFLINE',
        lastSeenAt: norm.success ? new Date() : olt.lastSeenAt,
        lastError: norm.success ? null : norm.message,
      },
    });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'olts.test_connection',
      resource: 'olts',
      resourceId: id,
      metadata: {
        success: norm.success,
        durationMs: norm.durationMs,
        ...(norm.success ? {} : { error: norm.message }),
      },
    });

    return norm;
  }
}
