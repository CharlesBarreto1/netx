/**
 * OltProvisioningProfilesService — CRUD dos templates de provisionamento +
 * resolução (Plan ?? OLT default) pra o ProvisioningService.
 *
 * O template é estruturado (perfis de banda por nome + VLANs com papel +
 * protocolo). O driver (ZyxelZynosDriver) renderiza o CLI a partir do
 * ResolvedProvisioningProfile devolvido por `resolveForInstall`.
 *
 * @provenance Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=
 */
import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  paginationMeta,
  type CreateProvisioningProfileRequest,
  type ListProvisioningProfilesQuery,
  type Paginated,
  type ProvisioningProfileResponse,
  type UpdateProvisioningProfileRequest,
} from '@netx/shared';
import { Prisma } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

import type { ResolvedProvisioningProfile } from './drivers/olt-driver.interface';

const PROFILE_INCLUDE = {
  vlans: { orderBy: [{ order: 'asc' }, { vid: 'asc' }] },
  _count: { select: { defaultForOlts: true, plans: true } },
} satisfies Prisma.OltProvisioningProfileInclude;

type ProfileRow = Prisma.OltProvisioningProfileGetPayload<{
  include: typeof PROFILE_INCLUDE;
}>;

function toResponse(p: ProfileRow): ProvisioningProfileResponse {
  return {
    id: p.id,
    tenantId: p.tenantId,
    name: p.name,
    description: p.description,
    vendor: p.vendor,
    ontPassword: p.ontPassword,
    fullBridge: p.fullBridge,
    bwUpProfileName: p.bwUpProfileName,
    bwDownProfileName: p.bwDownProfileName,
    bwGroupId: p.bwGroupId,
    uniPort: p.uniPort,
    serviceProtocol: p.serviceProtocol,
    queueTc: p.queueTc,
    queuePriority: p.queuePriority,
    queueWeight: p.queueWeight,
    ingressProfile: p.ingressProfile,
    vlans: p.vlans.map((v) => ({
      id: v.id,
      vid: v.vid,
      role: v.role,
      tagged: v.tagged,
      isPvid: v.isPvid,
      isProtocolBased: v.isProtocolBased,
      order: v.order,
    })),
    defaultForOltsCount: p._count.defaultForOlts,
    plansCount: p._count.plans,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

/** Mapeia uma row (com vlans) pro tipo de domínio que o driver consome. */
function toResolved(
  p: Prisma.OltProvisioningProfileGetPayload<{ include: { vlans: true } }>,
): ResolvedProvisioningProfile {
  return {
    ontPassword: p.ontPassword,
    fullBridge: p.fullBridge,
    bwUpProfileName: p.bwUpProfileName,
    bwDownProfileName: p.bwDownProfileName,
    bwGroupId: p.bwGroupId,
    uniPort: p.uniPort,
    serviceProtocol: p.serviceProtocol,
    queueTc: p.queueTc,
    queuePriority: p.queuePriority,
    queueWeight: p.queueWeight,
    ingressProfile: p.ingressProfile,
    vlans: [...p.vlans]
      .sort((a, b) => a.order - b.order || a.vid - b.vid)
      .map((v) => ({
        vid: v.vid,
        role: v.role,
        tagged: v.tagged,
        isPvid: v.isPvid,
        isProtocolBased: v.isProtocolBased,
      })),
  };
}

@Injectable()
export class OltProvisioningProfilesService {
  private readonly logger = new Logger(OltProvisioningProfilesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(
    tenantId: string,
    actorUserId: string,
    input: CreateProvisioningProfileRequest,
  ): Promise<ProvisioningProfileResponse> {
    try {
      const created = await this.prisma.oltProvisioningProfile.create({
        data: {
          tenantId,
          name: input.name,
          description: input.description ?? null,
          vendor: input.vendor,
          ontPassword: input.ontPassword,
          fullBridge: input.fullBridge,
          bwUpProfileName: input.bwUpProfileName,
          bwDownProfileName: input.bwDownProfileName,
          bwGroupId: input.bwGroupId,
          uniPort: input.uniPort,
          serviceProtocol: input.serviceProtocol,
          queueTc: input.queueTc,
          queuePriority: input.queuePriority,
          queueWeight: input.queueWeight,
          ingressProfile: input.ingressProfile,
          vlans: {
            create: input.vlans.map((v) => ({
              vid: v.vid,
              role: v.role,
              tagged: v.tagged,
              isPvid: v.isPvid,
              isProtocolBased: v.isProtocolBased,
              order: v.order,
            })),
          },
        },
        include: PROFILE_INCLUDE,
      });
      await this.audit.log({
        tenantId,
        userId: actorUserId,
        action: 'olt_provisioning_profiles.created',
        resource: 'olt_provisioning_profiles',
        resourceId: created.id,
      });
      return toResponse(created);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Já existe um template com esse nome');
      }
      throw err;
    }
  }

  async list(
    tenantId: string,
    q: ListProvisioningProfilesQuery,
  ): Promise<Paginated<ProvisioningProfileResponse>> {
    const where: Prisma.OltProvisioningProfileWhereInput = {
      tenantId,
      deletedAt: null,
      ...(q.vendor && { vendor: q.vendor }),
      ...(q.search && {
        OR: [
          { name: { contains: q.search, mode: 'insensitive' } },
          { description: { contains: q.search, mode: 'insensitive' } },
        ],
      }),
    };
    const skip = (q.page - 1) * q.pageSize;
    const [rows, total] = await Promise.all([
      this.prisma.oltProvisioningProfile.findMany({
        where,
        orderBy: { name: 'asc' },
        skip,
        take: q.pageSize,
        include: PROFILE_INCLUDE,
      }),
      this.prisma.oltProvisioningProfile.count({ where }),
    ]);
    return {
      data: rows.map(toResponse),
      pagination: paginationMeta(total, q.page, q.pageSize),
    };
  }

  async findById(tenantId: string, id: string): Promise<ProvisioningProfileResponse> {
    const row = await this.prisma.oltProvisioningProfile.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: PROFILE_INCLUDE,
    });
    if (!row) throw new NotFoundException('Template não encontrado');
    return toResponse(row);
  }

  async update(
    tenantId: string,
    actorUserId: string,
    id: string,
    input: UpdateProvisioningProfileRequest,
  ): Promise<ProvisioningProfileResponse> {
    const existing = await this.prisma.oltProvisioningProfile.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Template não encontrado');

    const data: Prisma.OltProvisioningProfileUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description ?? null;
    if (input.vendor !== undefined) data.vendor = input.vendor;
    if (input.ontPassword !== undefined) data.ontPassword = input.ontPassword;
    if (input.fullBridge !== undefined) data.fullBridge = input.fullBridge;
    if (input.bwUpProfileName !== undefined) data.bwUpProfileName = input.bwUpProfileName;
    if (input.bwDownProfileName !== undefined) data.bwDownProfileName = input.bwDownProfileName;
    if (input.bwGroupId !== undefined) data.bwGroupId = input.bwGroupId;
    if (input.uniPort !== undefined) data.uniPort = input.uniPort;
    if (input.serviceProtocol !== undefined) data.serviceProtocol = input.serviceProtocol;
    if (input.queueTc !== undefined) data.queueTc = input.queueTc;
    if (input.queuePriority !== undefined) data.queuePriority = input.queuePriority;
    if (input.queueWeight !== undefined) data.queueWeight = input.queueWeight;
    if (input.ingressProfile !== undefined) data.ingressProfile = input.ingressProfile;

    try {
      // VLANs = replace total quando enviadas (mais simples e previsível que diff).
      const updated = await this.prisma.$transaction(async (tx) => {
        if (input.vlans) {
          await tx.oltProfileVlan.deleteMany({ where: { profileId: id } });
          await tx.oltProfileVlan.createMany({
            data: input.vlans.map((v) => ({
              profileId: id,
              vid: v.vid,
              role: v.role,
              tagged: v.tagged,
              isPvid: v.isPvid,
              isProtocolBased: v.isProtocolBased,
              order: v.order,
            })),
          });
        }
        return tx.oltProvisioningProfile.update({
          where: { id },
          data,
          include: PROFILE_INCLUDE,
        });
      });
      await this.audit.log({
        tenantId,
        userId: actorUserId,
        action: 'olt_provisioning_profiles.updated',
        resource: 'olt_provisioning_profiles',
        resourceId: id,
      });
      return toResponse(updated);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Já existe um template com esse nome');
      }
      throw err;
    }
  }

  async remove(tenantId: string, actorUserId: string, id: string): Promise<void> {
    const existing = await this.prisma.oltProvisioningProfile.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: { _count: { select: { defaultForOlts: true, plans: true } } },
    });
    if (!existing) throw new NotFoundException('Template não encontrado');
    const refs = existing._count.defaultForOlts + existing._count.plans;
    if (refs > 0) {
      throw new ConflictException(
        `Template em uso por ${existing._count.defaultForOlts} OLT(s) e ` +
          `${existing._count.plans} plano(s) — desvincule antes de excluir`,
      );
    }
    // Soft-delete (mantém histórico). VLANs ficam (cascade só em hard-delete);
    // como o template some das listas, não há impacto prático.
    await this.prisma.oltProvisioningProfile.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'olt_provisioning_profiles.deleted',
      resource: 'olt_provisioning_profiles',
      resourceId: id,
    });
  }

  /**
   * Resolve o template efetivo pra um install: override do plano vence o
   * default da OLT. Retorna null se nenhum dos dois tem template (drivers que
   * não exigem profile — ex: EXTERNAL/Ufinet — seguem normalmente).
   */
  async resolveForInstall(
    tenantId: string,
    planId: string | null,
    oltId: string,
  ): Promise<ResolvedProvisioningProfile | null> {
    if (planId) {
      const plan = await this.prisma.plan.findFirst({
        where: { id: planId, tenantId },
        select: {
          provisioningProfile: {
            where: { deletedAt: null },
            include: { vlans: true },
          },
        },
      });
      if (plan?.provisioningProfile) return toResolved(plan.provisioningProfile);
    }
    const olt = await this.prisma.olt.findFirst({
      where: { id: oltId, tenantId },
      select: {
        defaultProvisioningProfile: {
          where: { deletedAt: null },
          include: { vlans: true },
        },
      },
    });
    if (olt?.defaultProvisioningProfile) return toResolved(olt.defaultProvisioningProfile);
    return null;
  }
}
