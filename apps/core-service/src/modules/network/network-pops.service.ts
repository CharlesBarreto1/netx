import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

export interface CreatePopInput {
  name: string;
  code?: string | null;
  city?: string | null;
  state?: string | null;
  address?: string | null;
  notes?: string | null;
  isActive?: boolean;
}

export type UpdatePopInput = Partial<CreatePopInput>;

@Injectable()
export class NetworkPopsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(tenantId: string) {
    return this.prisma.networkPop.findMany({
      where: { tenantId, deletedAt: null },
      include: { _count: { select: { equipment: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async findById(tenantId: string, id: string) {
    const pop = await this.prisma.networkPop.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: { equipment: { where: { deletedAt: null } } },
    });
    if (!pop) throw new NotFoundException('POP não encontrado');
    return pop;
  }

  async create(tenantId: string, actorUserId: string, input: CreatePopInput) {
    try {
      const pop = await this.prisma.networkPop.create({
        data: {
          tenantId,
          name: input.name.trim(),
          code: input.code?.trim() || null,
          city: input.city?.trim() || null,
          state: input.state?.trim() || null,
          address: input.address?.trim() || null,
          notes: input.notes ?? null,
          isActive: input.isActive ?? true,
          createdById: actorUserId,
          updatedById: actorUserId,
        },
      });
      await this.audit.log({
        tenantId,
        userId: actorUserId,
        action: 'network.pop.created',
        resource: 'network_pops',
        resourceId: pop.id,
        afterState: { name: pop.name, code: pop.code, city: pop.city },
      });
      return pop;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Já existe POP com esse nome ou código');
      }
      throw err;
    }
  }

  async update(
    tenantId: string,
    actorUserId: string,
    id: string,
    input: UpdatePopInput,
  ) {
    const before = await this.findById(tenantId, id);
    try {
      const pop = await this.prisma.networkPop.update({
        where: { id: before.id },
        data: {
          name: input.name?.trim(),
          code: input.code === undefined ? undefined : input.code?.trim() || null,
          city: input.city === undefined ? undefined : input.city?.trim() || null,
          state: input.state === undefined ? undefined : input.state?.trim() || null,
          address:
            input.address === undefined ? undefined : input.address?.trim() || null,
          notes: input.notes === undefined ? undefined : input.notes ?? null,
          isActive: input.isActive,
          updatedById: actorUserId,
        },
      });
      await this.audit.log({
        tenantId,
        userId: actorUserId,
        action: 'network.pop.updated',
        resource: 'network_pops',
        resourceId: pop.id,
      });
      return pop;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Já existe POP com esse nome ou código');
      }
      throw err;
    }
  }

  async remove(tenantId: string, actorUserId: string, id: string) {
    const before = await this.findById(tenantId, id);
    await this.prisma.networkPop.update({
      where: { id: before.id },
      data: { deletedAt: new Date(), updatedById: actorUserId },
    });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'network.pop.deleted',
      resource: 'network_pops',
      resourceId: before.id,
    });
  }
}
