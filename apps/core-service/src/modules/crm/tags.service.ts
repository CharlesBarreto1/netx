import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import type {
  CreateCustomerTagRequest,
  CustomerTagResponse,
  UpdateCustomerTagRequest,
} from '@netx/shared';

import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class CustomerTagsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(tenantId: string): Promise<CustomerTagResponse[]> {
    const rows = await this.prisma.customerTag.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
      include: { _count: { select: { assignments: true } } },
    });
    return rows.map((t) => ({
      id: t.id,
      tenantId: t.tenantId,
      name: t.name,
      color: t.color,
      description: t.description,
      customerCount: t._count.assignments,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    }));
  }

  async create(
    tenantId: string,
    actorUserId: string,
    input: CreateCustomerTagRequest,
  ): Promise<CustomerTagResponse> {
    try {
      const row = await this.prisma.customerTag.create({
        data: {
          tenantId,
          name: input.name,
          color: input.color ?? null,
          description: input.description ?? null,
        },
      });
      await this.audit.log({
        tenantId,
        userId: actorUserId,
        action: 'customer.tag.created',
        resource: 'customer_tags',
        resourceId: row.id,
        afterState: { name: row.name },
      });
      return toTagResponse(row);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException(`Tag "${input.name}" já existe neste tenant`);
      }
      throw e;
    }
  }

  async update(
    tenantId: string,
    actorUserId: string,
    tagId: string,
    input: UpdateCustomerTagRequest,
  ): Promise<CustomerTagResponse> {
    const before = await this.prisma.customerTag.findFirst({
      where: { id: tagId, tenantId },
    });
    if (!before) throw new NotFoundException('Tag não encontrada');

    try {
      const row = await this.prisma.customerTag.update({
        where: { id: tagId },
        data: {
          name: input.name,
          color: input.color,
          description: input.description,
        },
      });
      await this.audit.log({
        tenantId,
        userId: actorUserId,
        action: 'customer.tag.updated',
        resource: 'customer_tags',
        resourceId: tagId,
        beforeState: { name: before.name },
        afterState: { name: row.name },
      });
      return toTagResponse(row);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException(`Tag "${input.name}" já existe neste tenant`);
      }
      throw e;
    }
  }

  async remove(tenantId: string, actorUserId: string, tagId: string): Promise<void> {
    const { count } = await this.prisma.customerTag.deleteMany({
      where: { id: tagId, tenantId },
    });
    if (count === 0) throw new NotFoundException('Tag não encontrada');
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'customer.tag.deleted',
      resource: 'customer_tags',
      resourceId: tagId,
    });
  }
}

function toTagResponse(t: {
  id: string;
  tenantId: string;
  name: string;
  color: string | null;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}): CustomerTagResponse {
  return {
    id: t.id,
    tenantId: t.tenantId,
    name: t.name,
    color: t.color,
    description: t.description,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}
