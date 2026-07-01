import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { CreateIpamVrfRequest, UpdateIpamVrfRequest } from '@netx/shared';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

/** VRFs / espaços de roteamento. Opcional — a maioria usa só o default (null). */
@Injectable()
export class IpamVrfsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string) {
    return this.prisma.ipamVrf.findMany({ where: { tenantId }, orderBy: { name: 'asc' } });
  }

  async create(tenantId: string, actorId: string, input: CreateIpamVrfRequest) {
    try {
      const created = await this.prisma.ipamVrf.create({
        data: {
          tenantId,
          name: input.name.trim(),
          rd: input.rd ?? null,
          description: input.description ?? null,
          isDefault: input.isDefault ?? false,
        },
      });
      await this.audit.log({
        tenantId,
        userId: actorId,
        action: 'ipam.vrf.created',
        resource: 'ipam_vrf',
        resourceId: created.id,
        afterState: { name: created.name },
      });
      return created;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
        throw new ConflictException('Já existe um VRF com esse nome');
      throw e;
    }
  }

  async update(tenantId: string, actorId: string, id: string, input: UpdateIpamVrfRequest) {
    const existing = await this.prisma.ipamVrf.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('VRF não encontrado');
    const updated = await this.prisma.ipamVrf.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.rd !== undefined ? { rd: input.rd } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
      },
    });
    await this.audit.log({
      tenantId,
      userId: actorId,
      action: 'ipam.vrf.updated',
      resource: 'ipam_vrf',
      resourceId: id,
    });
    return updated;
  }

  async remove(tenantId: string, actorId: string, id: string) {
    const existing = await this.prisma.ipamVrf.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('VRF não encontrado');
    const prefixes = await this.prisma.ipamPrefix.count({ where: { vrfId: id, deletedAt: null } });
    if (prefixes > 0) throw new ConflictException('VRF tem prefixos vinculados');
    await this.prisma.ipamVrf.delete({ where: { id } });
    await this.audit.log({
      tenantId,
      userId: actorId,
      action: 'ipam.vrf.deleted',
      resource: 'ipam_vrf',
      resourceId: id,
      beforeState: { name: existing.name },
    });
  }
}
