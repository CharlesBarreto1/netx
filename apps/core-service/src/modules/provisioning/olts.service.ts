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

import { OltDriverFactory } from './drivers/olt-driver.factory';
import { buildConnectionContext } from './olt-context.util';

type OltRow = Prisma.OltGetPayload<{
  include: { pop: { select: { id: true; name: true; code: true } } };
}>;

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
    status: o.status,
    lastSeenAt: o.lastSeenAt?.toISOString() ?? null,
    lastError: o.lastError,
    latitude: o.latitude != null ? Number(o.latitude) : null,
    longitude: o.longitude != null ? Number(o.longitude) : null,
    popId: o.popId,
    pop: o.pop,
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
          latitude: input.latitude ?? null,
          longitude: input.longitude ?? null,
          popId: input.popId ?? null,
        },
        include: { pop: { select: { id: true, name: true, code: true } } },
      });
      await this.audit.log({
        tenantId,
        userId: actorUserId,
        action: 'olts.created',
        resource: 'olts',
        resourceId: created.id,
      });
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
        include: { pop: { select: { id: true, name: true, code: true } } },
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
      include: { pop: { select: { id: true, name: true, code: true } } },
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
      include: { pop: { select: { id: true, name: true, code: true } } },
    });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'olts.updated',
      resource: 'olts',
      resourceId: id,
    });
    return toResponse(updated);
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

    const ctx = buildConnectionContext(olt, this.crypto);
    const driver = this.drivers.resolve(olt.vendor, olt.providerMode);
    const result = await driver.testConnection(ctx);

    await this.prisma.olt.update({
      where: { id },
      data: {
        status: result.success ? 'ONLINE' : 'OFFLINE',
        lastSeenAt: result.success ? new Date() : olt.lastSeenAt,
        lastError: result.success ? null : result.error,
      },
    });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'olts.test_connection',
      resource: 'olts',
      resourceId: id,
      metadata: {
        success: result.success,
        durationMs: result.durationMs,
        ...(result.success ? {} : { error: result.error }),
      },
    });

    return {
      success: result.success,
      message: result.success ? result.data.message : result.error,
      durationMs: result.durationMs,
    };
  }
}
