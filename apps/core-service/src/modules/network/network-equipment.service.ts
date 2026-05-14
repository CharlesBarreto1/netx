import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DisconnectStrategy as DisconnectStrategyEnum,
  NetworkEquipmentType,
  NetworkEquipmentVendor,
  Prisma,
} from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import { CryptoService } from '../crypto/crypto.service';
import { DisconnectService } from '../disconnect/disconnect.service';
import { PrismaService } from '../prisma/prisma.service';
import { RadiusNasSyncService } from './radius-nas-sync.service';

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
  notes?: string | null;
  isActive?: boolean;
}

export type UpdateEquipmentInput = Partial<CreateEquipmentInput>;

/**
 * Hook side-effect: BNG → radius.nas. Falhas no sync NÃO impedem o
 * cadastro do equipamento — logamos como ERROR no audit pra investigação.
 * Operador pode forçar resync chamando o endpoint /resync.
 */
@Injectable()
export class NetworkEquipmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly nasSync: RadiusNasSyncService,
    private readonly crypto: CryptoService,
    private readonly disconnect: DisconnectService,
  ) {}

  /**
   * Sanitiza output removendo passwords cifrados (mas mantém flag indicando
   * que existe credencial salva — UI mostra "•••• preenchido").
   */
  private maskCredentials<T extends {
    apiPasswordEnc?: string | null;
    sshPasswordEnc?: string | null;
  }>(eq: T): Omit<T, 'apiPasswordEnc' | 'sshPasswordEnc'> & {
    hasApiPassword: boolean;
    hasSshPassword: boolean;
  } {
    const { apiPasswordEnc, sshPasswordEnc, ...rest } = eq;
    return {
      ...rest,
      hasApiPassword: !!apiPasswordEnc,
      hasSshPassword: !!sshPasswordEnc,
    };
  }

  // ───────────────────────────────────────────────────────────────────────
  // Read
  // ───────────────────────────────────────────────────────────────────────
  async list(
    tenantId: string,
    filter?: { type?: NetworkEquipmentType; popId?: string },
  ) {
    return this.prisma.networkEquipment.findMany({
      where: {
        tenantId,
        deletedAt: null,
        ...(filter?.type ? { type: filter.type } : {}),
        ...(filter?.popId ? { popId: filter.popId } : {}),
      },
      include: { pop: { select: { id: true, name: true, code: true } } },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    });
  }

  async findById(tenantId: string, id: string) {
    const eq = await this.prisma.networkEquipment.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: { pop: true },
    });
    if (!eq) throw new NotFoundException('Equipamento não encontrado');
    return eq;
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
    try {
      const eq = await this.prisma.networkEquipment.create({
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
          notes: input.notes ?? null,
          isActive: input.isActive ?? true,
          createdById: actorUserId,
          updatedById: actorUserId,
        },
        include: { pop: true },
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
      return eq;
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
      return eq;
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
