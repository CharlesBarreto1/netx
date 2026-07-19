import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  DisconnectStrategy as DisconnectStrategyEnum,
  NetworkEquipmentType,
  NetworkEquipmentVendor,
  Prisma,
} from '@prisma/client';
import { execFile } from 'node:child_process';

import { AuditService } from '../audit/audit.service';
import { CryptoService } from '../crypto/crypto.service';
import { IpamSyncService } from '../ipam/ipam-sync.service';
import { DisconnectService } from '../disconnect/disconnect.service';
import { PrismaService } from '../prisma/prisma.service';
import { DeploymentService } from '../stock/deployment.service';
import { RadiusNasSyncService } from './radius-nas-sync.service';

/**
 * Dispara scripts do installer pra ressincronizar UFW e NTP allowlist quando
 * NetworkEquipment muda. Falhas não bloqueiam — só logam (operador pode rodar
 * scripts manualmente: `sudo /opt/netx/infra/installer/scripts/sync-firewall.sh`).
 *
 * Requer sudoers config:
 *   netx ALL=(root) NOPASSWD: /opt/netx/infra/installer/scripts/sync-firewall.sh,\
 *                              /opt/netx/infra/installer/scripts/sync-ntp.sh
 */
const SYNC_SCRIPTS = {
  firewall: process.env.NETX_SYNC_FIREWALL_SCRIPT ??
    '/opt/netx/infra/installer/scripts/sync-firewall.sh',
  ntp: process.env.NETX_SYNC_NTP_SCRIPT ??
    '/opt/netx/infra/installer/scripts/sync-ntp.sh',
};

export interface CreateEquipmentInput {
  popId?: string | null;
  type: NetworkEquipmentType;
  vendor?: NetworkEquipmentVendor;
  name: string;
  hostname?: string | null;
  ipAddress: string;
  // RADIUS — só pra BNG
  radiusSecret?: string | null;
  radiusNasType?: string | null;
  // SNMP — pra OLT/Router
  snmpCommunity?: string | null;
  snmpVersion?: string | null;
  // Disconnect multi-vendor
  disconnectStrategy?: DisconnectStrategyEnum;
  coaPort?: number | null;
  // RouterOS API
  apiHost?: string | null;
  apiPort?: number | null;
  apiUser?: string | null;
  apiPassword?: string | null; // plaintext no input — cifrado antes de salvar
  apiTlsEnabled?: boolean;
  // SSH
  sshHost?: string | null;
  sshPort?: number | null;
  sshUser?: string | null;
  sshPassword?: string | null; // plaintext no input
  sshKeyName?: string | null;
  sshDisconnectCmd?: string | null;
  /** Coordenadas pro mapa de Rede. */
  latitude?: number | null;
  longitude?: number | null;
  notes?: string | null;
  isActive?: boolean;
  /**
   * Bem do estoque que ESTE equipamento é. Quando informado, o cadastro
   * consome o patrimônio na mesma transação (IN_STOCK → IN_USE) em vez de o
   * operador redigitar serial/marca/modelo numa segunda tela. Exige popId —
   * instalar um bem sem dizer onde não é rastreável.
   */
  serialItemId?: string | null;
}

export type UpdateEquipmentInput = Partial<CreateEquipmentInput>;

/**
 * Hook side-effect: BNG → radius.nas. Falhas no sync NÃO impedem o
 * cadastro do equipamento — logamos como ERROR no audit pra investigação.
 * Operador pode forçar resync chamando o endpoint /resync.
 */
@Injectable()
export class NetworkEquipmentService {
  private readonly logger = new Logger(NetworkEquipmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly nasSync: RadiusNasSyncService,
    private readonly crypto: CryptoService,
    private readonly disconnect: DisconnectService,
    private readonly ipamSync: IpamSyncService,
    private readonly deployment: DeploymentService,
  ) {}

  /** Espelho best-effort do IP de gerência no IPAM — nunca quebra a operação. */
  private async syncIpamEquipment(
    tenantId: string,
    actorUserId: string,
    equipmentId: string,
    ipAddress: string | null,
  ): Promise<void> {
    try {
      await this.ipamSync.setEquipmentIp(tenantId, actorUserId, equipmentId, ipAddress);
    } catch (e) {
      this.logger.warn(
        `[network] IPAM sync falhou p/ equipamento ${equipmentId}: ${(e as Error).message}`,
      );
    }
  }

  /**
   * Dispara scripts de sync infra (UFW + NTP allowlist) via sudo. Non-blocking:
   * roda em background, falhas só logam. Operador sempre pode rodar manual.
   */
  private async syncInfra(): Promise<void> {
    const run = (script: string, label: string): Promise<void> =>
      new Promise((resolve) => {
        execFile('sudo', ['-n', script], { timeout: 8000 }, (err, _out, stderr) => {
          if (err) {
            this.logger.warn(
              `[infra-sync:${label}] falhou: ${err.message} ${stderr?.slice(0, 200) ?? ''}`,
            );
          } else {
            this.logger.log(`[infra-sync:${label}] OK`);
          }
          resolve();
        });
      });

    await Promise.all([
      run(SYNC_SCRIPTS.firewall, 'firewall'),
      run(SYNC_SCRIPTS.ntp, 'ntp'),
    ]);
  }

  /**
   * Sanitiza output removendo passwords cifrados (mas mantém flag indicando
   * que existe credencial salva — UI mostra "•••• preenchido").
   */
  private maskCredentials<T extends {
    apiPasswordEnc?: string | null;
    sshPasswordEnc?: string | null;
    latitude?: unknown;
    longitude?: unknown;
  }>(eq: T): Omit<T, 'apiPasswordEnc' | 'sshPasswordEnc'> & {
    hasApiPassword: boolean;
    hasSshPassword: boolean;
  } {
    const { apiPasswordEnc, sshPasswordEnc, latitude, longitude, ...rest } = eq;
    return {
      ...rest,
      hasApiPassword: !!apiPasswordEnc,
      hasSshPassword: !!sshPasswordEnc,
      // Prisma retorna Decimal; convertemos pra number pra bater com DTO
      // Response do @netx/shared (latitude: number | null).
      latitude: latitude != null ? Number(latitude) : null,
      longitude: longitude != null ? Number(longitude) : null,
    } as Omit<T, 'apiPasswordEnc' | 'sshPasswordEnc'> & {
      hasApiPassword: boolean;
      hasSshPassword: boolean;
    };
  }

  // ───────────────────────────────────────────────────────────────────────
  // Read
  // ───────────────────────────────────────────────────────────────────────
  async list(
    tenantId: string,
    filter?: { type?: NetworkEquipmentType; popId?: string },
  ) {
    const rows = await this.prisma.networkEquipment.findMany({
      where: {
        tenantId,
        deletedAt: null,
        ...(filter?.type ? { type: filter.type } : {}),
        ...(filter?.popId ? { popId: filter.popId } : {}),
      },
      include: { pop: { select: { id: true, name: true, code: true } } },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    });
    return rows.map((r) => this.maskCredentials(r));
  }

  /** Variante "raw" pra uso interno (update precisa do ID + nome originais). */
  private async findByIdRaw(tenantId: string, id: string) {
    const eq = await this.prisma.networkEquipment.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: { pop: true },
    });
    if (!eq) throw new NotFoundException('Equipamento não encontrado');
    return eq;
  }

  async findById(tenantId: string, id: string) {
    const eq = await this.findByIdRaw(tenantId, id);
    return this.maskCredentials(eq);
  }

  // ───────────────────────────────────────────────────────────────────────
  // Validações de input
  // ───────────────────────────────────────────────────────────────────────
  private validateBngFields(input: CreateEquipmentInput | UpdateEquipmentInput) {
    if (input.type === 'BNG') {
      if (!input.radiusSecret || input.radiusSecret.trim().length < 4) {
        throw new BadRequestException(
          'BNG exige radiusSecret (mínimo 4 caracteres)',
        );
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // Create
  // ───────────────────────────────────────────────────────────────────────
  async create(
    tenantId: string,
    actorUserId: string,
    input: CreateEquipmentInput,
  ) {
    this.validateBngFields(input);
    // Consumir do estoque exige saber ONDE o bem foi parar. Sem POP o
    // patrimônio ficaria IN_USE sem localização — pior que não vincular.
    if (input.serialItemId && !input.popId) {
      throw new BadRequestException(
        'Informe o POP para vincular um patrimônio do estoque a este equipamento',
      );
    }
    try {
      const eq = await this.prisma.$transaction(async (tx) => {
      const created = await tx.networkEquipment.create({
        data: {
          tenantId,
          popId: input.popId ?? null,
          type: input.type,
          vendor: input.vendor ?? 'OTHER',
          name: input.name.trim(),
          hostname: input.hostname?.trim() || null,
          ipAddress: input.ipAddress.trim(),
          radiusSecret: input.type === 'BNG' ? input.radiusSecret ?? null : null,
          radiusNasType: input.type === 'BNG' ? input.radiusNasType ?? 'mikrotik' : null,
          snmpCommunity: input.snmpCommunity ?? null,
          snmpVersion: input.snmpVersion ?? null,
          latitude: input.latitude ?? null,
          longitude: input.longitude ?? null,
          notes: input.notes ?? null,
          isActive: input.isActive ?? true,
          createdById: actorUserId,
          updatedById: actorUserId,
        },
        include: { pop: true },
      });

      // Consome o bem do estoque na MESMA transação: se a instalação falhar
      // (bem já em uso, em comodato, inexistente), o equipamento não é criado.
      // É o oposto do que acontecia antes, quando o cadastro de equipamento
      // ignorava o estoque e os dois viravam registros paralelos.
      if (input.serialItemId) {
        await this.deployment.deploy(
          tenantId,
          actorUserId,
          {
            serialItemId: input.serialItemId,
            popId: input.popId!,
            networkEquipmentId: created.id,
            notes: `Instalado como equipamento "${created.name}"`,
          },
          tx,
        );
      }

      return created;
      });

      // Sync RADIUS — só BNG ativo.
      if (eq.type === 'BNG' && eq.isActive && eq.radiusSecret) {
        await this.syncToRadius(eq);
      }

      await this.audit.log({
        tenantId,
        userId: actorUserId,
        action: 'network.equipment.created',
        resource: 'network_equipment',
        resourceId: eq.id,
        afterState: {
          type: eq.type,
          vendor: eq.vendor,
          name: eq.name,
          ipAddress: eq.ipAddress,
        },
      });
      // IPAM: documenta o IP de gerência do equipamento.
      await this.syncIpamEquipment(tenantId, actorUserId, eq.id, eq.ipAddress);
      // Background — atualiza UFW e NTP allowlist, não bloqueia o request
      void this.syncInfra();
      return this.maskCredentials(eq);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Já existe equipamento com esse nome ou IP');
      }
      throw err;
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // Update
  // ───────────────────────────────────────────────────────────────────────
  async update(
    tenantId: string,
    actorUserId: string,
    id: string,
    input: UpdateEquipmentInput,
  ) {
    const before = await this.findById(tenantId, id);
    if (input.type) this.validateBngFields({ ...before, ...input } as never);

    try {
      // Cifra passwords se novos foram passados. Plaintext vazio => limpa.
      // undefined => mantém o atual (não toca).
      const apiPasswordEnc =
        input.apiPassword === undefined
          ? undefined
          : input.apiPassword === null || input.apiPassword === ''
            ? null
            : this.crypto.encrypt(input.apiPassword);

      const sshPasswordEnc =
        input.sshPassword === undefined
          ? undefined
          : input.sshPassword === null || input.sshPassword === ''
            ? null
            : this.crypto.encrypt(input.sshPassword);

      const eq = await this.prisma.networkEquipment.update({
        where: { id: before.id },
        data: {
          popId: input.popId === undefined ? undefined : input.popId,
          type: input.type,
          vendor: input.vendor,
          name: input.name?.trim(),
          hostname: input.hostname === undefined ? undefined : input.hostname?.trim() || null,
          ipAddress: input.ipAddress?.trim(),
          radiusSecret:
            input.radiusSecret === undefined ? undefined : input.radiusSecret ?? null,
          radiusNasType:
            input.radiusNasType === undefined ? undefined : input.radiusNasType ?? null,
          snmpCommunity:
            input.snmpCommunity === undefined ? undefined : input.snmpCommunity ?? null,
          snmpVersion:
            input.snmpVersion === undefined ? undefined : input.snmpVersion ?? null,
          // Disconnect multi-vendor
          disconnectStrategy: input.disconnectStrategy,
          coaPort: input.coaPort === undefined ? undefined : input.coaPort ?? null,
          apiHost: input.apiHost === undefined ? undefined : input.apiHost ?? null,
          apiPort: input.apiPort === undefined ? undefined : input.apiPort ?? null,
          apiUser: input.apiUser === undefined ? undefined : input.apiUser ?? null,
          apiPasswordEnc,
          apiTlsEnabled: input.apiTlsEnabled,
          sshHost: input.sshHost === undefined ? undefined : input.sshHost ?? null,
          sshPort: input.sshPort === undefined ? undefined : input.sshPort ?? null,
          sshUser: input.sshUser === undefined ? undefined : input.sshUser ?? null,
          sshPasswordEnc,
          sshKeyName:
            input.sshKeyName === undefined ? undefined : input.sshKeyName ?? null,
          sshDisconnectCmd:
            input.sshDisconnectCmd === undefined
              ? undefined
              : input.sshDisconnectCmd ?? null,
          latitude:
            input.latitude === undefined ? undefined : input.latitude ?? null,
          longitude:
            input.longitude === undefined ? undefined : input.longitude ?? null,
          notes: input.notes === undefined ? undefined : input.notes ?? null,
          isActive: input.isActive,
          updatedById: actorUserId,
        },
        include: { pop: true },
      });

      // Re-sync RADIUS:
      //   1. Se virou BNG ativo → upsert
      //   2. Se deixou de ser BNG OU ficou inativo → remove pelo IP antigo
      //   3. Se IP mudou → remove o antigo e upsert novo
      if (before.ipAddress !== eq.ipAddress) {
        await this.nasSync.remove(before.ipAddress).catch((e) =>
          this.logSyncFailure(tenantId, before.id, 'remove_old_ip', e),
        );
      }
      if (eq.type === 'BNG' && eq.isActive && eq.radiusSecret) {
        await this.syncToRadius(eq);
      } else if (before.type === 'BNG') {
        // Era BNG e deixou de ser (ou desativou) — remove
        await this.nasSync.remove(eq.ipAddress).catch((e) =>
          this.logSyncFailure(tenantId, eq.id, 'remove_after_demote', e),
        );
      }

      await this.audit.log({
        tenantId,
        userId: actorUserId,
        action: 'network.equipment.updated',
        resource: 'network_equipment',
        resourceId: eq.id,
      });
      // IPAM: reconcilia o IP de gerência (troca de IP libera o antigo).
      await this.syncIpamEquipment(tenantId, actorUserId, eq.id, eq.ipAddress);
      // Background — atualiza UFW e NTP allowlist, não bloqueia o request
      void this.syncInfra();
      return this.maskCredentials(eq);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Já existe equipamento com esse nome ou IP');
      }
      throw err;
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // Delete (soft) + remove de radius.nas
  // ───────────────────────────────────────────────────────────────────────
  async remove(tenantId: string, actorUserId: string, id: string) {
    const before = await this.findById(tenantId, id);

    // Sufixa nome/ip pra liberar uniques (mesma estratégia dos contracts).
    const suffix = `__del_${Date.now().toString(36)}`;
    await this.prisma.networkEquipment.update({
      where: { id: before.id },
      data: {
        deletedAt: new Date(),
        updatedById: actorUserId,
        name: `${before.name}${suffix}`.slice(0, 120),
        ipAddress: `${before.ipAddress}${suffix}`.slice(0, 45),
      },
    });

    // Solta o patrimônio: o equipamento sumiu do cadastro, mas o BEM continua
    // fisicamente no POP (vira "IN_USE sem equipamento", estado legítimo — é o
    // mesmo de um rack ou nobreak). Recolher pro estoque é decisão do operador,
    // que exige escolher o local de destino. O onDelete SET NULL da FK não
    // cobre isto porque aqui é soft delete.
    await this.prisma.serialItem.updateMany({
      where: { tenantId, networkEquipmentId: before.id },
      data: { networkEquipmentId: null },
    });

    if (before.type === 'BNG') {
      await this.nasSync.remove(before.ipAddress).catch((e) =>
        this.logSyncFailure(tenantId, before.id, 'remove_on_delete', e),
      );
    }

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'network.equipment.deleted',
      resource: 'network_equipment',
      resourceId: before.id,
      beforeState: { name: before.name, ipAddress: before.ipAddress, type: before.type },
    });
    // IPAM: libera o IP de gerência documentado deste equipamento.
    await this.ipamSync
      .releaseEquipment(tenantId, actorUserId, before.id)
      .catch((e) => this.logger.warn(`[network] IPAM release falhou: ${(e as Error).message}`));
    // Background — atualiza UFW e NTP allowlist, não bloqueia o request
    void this.syncInfra();
  }

  // ───────────────────────────────────────────────────────────────────────
  // Resync forçado (admin pode chamar após restaurar backup, etc.)
  // ───────────────────────────────────────────────────────────────────────
  async resyncAllBngs(tenantId: string, actorUserId: string) {
    const bngs = await this.prisma.networkEquipment.findMany({
      where: {
        tenantId,
        type: 'BNG',
        isActive: true,
        deletedAt: null,
      },
      include: { pop: true },
    });
    let synced = 0;
    for (const eq of bngs) {
      if (!eq.radiusSecret) continue;
      try {
        await this.syncToRadius(eq);
        synced++;
      } catch (e) {
        this.logSyncFailure(tenantId, eq.id, 'resync_all', e);
      }
    }
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'network.bng.resync_all',
      level: 'WARNING',
      metadata: { totalBngs: bngs.length, synced },
    });
    return { totalBngs: bngs.length, synced };
  }

  // ───────────────────────────────────────────────────────────────────────
  // Test connection — usado pelo botão "Testar conectividade" na UI
  // ───────────────────────────────────────────────────────────────────────
  async testConnection(tenantId: string, actorUserId: string, id: string) {
    const eq = await this.findById(tenantId, id);
    const results = await this.disconnect.testEquipmentConnectivity(eq.id);
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'network.equipment.test_connection',
      resource: 'network_equipment',
      resourceId: eq.id,
      metadata: { results },
    });
    return { equipmentId: eq.id, name: eq.name, results };
  }

  // ───────────────────────────────────────────────────────────────────────
  // Helpers
  // ───────────────────────────────────────────────────────────────────────
  private async syncToRadius(eq: {
    id: string;
    name: string;
    ipAddress: string;
    radiusSecret: string | null;
    radiusNasType: string | null;
    pop?: { name: string } | null;
  }) {
    if (!eq.radiusSecret) return;
    await this.nasSync.upsert({
      ipAddress: eq.ipAddress,
      shortname: eq.name.replace(/\s+/g, '-').toLowerCase(),
      type: eq.radiusNasType,
      secret: eq.radiusSecret,
      description: `NetX-managed: ${eq.name}${eq.pop?.name ? ` @ ${eq.pop.name}` : ''}`,
    });
  }

  private logSyncFailure(
    tenantId: string,
    equipmentId: string,
    op: string,
    err: unknown,
  ) {
    void this.audit.log({
      tenantId,
      action: 'network.bng.sync_failed',
      level: 'WARNING',
      resource: 'network_equipment',
      resourceId: equipmentId,
      metadata: {
        op,
        error: err instanceof Error ? err.message : String(err),
      },
    });
  }
}
