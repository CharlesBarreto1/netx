import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import type {
  CreateNeighborhoodRequest,
  NeighborhoodResponse,
  UpdateNeighborhoodRequest,
} from '@netx/shared';

import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { assertBrTenant } from './br-tenant.util';

@Injectable()
export class NeighborhoodsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(tenantId: string, cityId: string): Promise<NeighborhoodResponse[]> {
    await assertBrTenant(this.prisma, tenantId);
    await this.assertCity(tenantId, cityId);
    const rows = await this.prisma.neighborhood.findMany({
      where: { tenantId, cityId },
      orderBy: [{ name: 'asc' }],
    });
    return rows.map(toResponse);
  }

  async create(
    tenantId: string,
    actorUserId: string,
    input: CreateNeighborhoodRequest,
  ): Promise<NeighborhoodResponse> {
    await assertBrTenant(this.prisma, tenantId);
    await this.assertCity(tenantId, input.cityId);
    let row;
    try {
      row = await this.prisma.neighborhood.create({
        data: { tenantId, cityId: input.cityId, name: input.name },
      });
    } catch (e) {
      throw mapDup(e, 'Bairro já cadastrado nesta cidade');
    }
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'location.neighborhood.created',
      resource: 'locations',
      resourceId: row.id,
      afterState: { cityId: row.cityId, name: row.name },
    });
    return toResponse(row);
  }

  async update(
    tenantId: string,
    actorUserId: string,
    id: string,
    input: UpdateNeighborhoodRequest,
  ): Promise<NeighborhoodResponse> {
    await assertBrTenant(this.prisma, tenantId);
    await this.assertExists(tenantId, id);
    let row;
    try {
      row = await this.prisma.neighborhood.update({
        where: { id },
        data: { name: input.name },
      });
    } catch (e) {
      throw mapDup(e, 'Bairro já cadastrado nesta cidade');
    }
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'location.neighborhood.updated',
      resource: 'locations',
      resourceId: id,
      afterState: { name: row.name },
    });
    return toResponse(row);
  }

  async remove(tenantId: string, actorUserId: string, id: string): Promise<void> {
    await assertBrTenant(this.prisma, tenantId);
    const { count } = await this.prisma.neighborhood.deleteMany({
      where: { id, tenantId },
    });
    if (count === 0) throw new NotFoundException('Bairro não encontrado');
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'location.neighborhood.deleted',
      resource: 'locations',
      resourceId: id,
    });
  }

  private async assertCity(tenantId: string, cityId: string): Promise<void> {
    const c = await this.prisma.city.findFirst({
      where: { id: cityId, tenantId },
      select: { id: true },
    });
    if (!c) throw new NotFoundException('Cidade não encontrada');
  }

  private async assertExists(tenantId: string, id: string): Promise<void> {
    const n = await this.prisma.neighborhood.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });
    if (!n) throw new NotFoundException('Bairro não encontrado');
  }
}

function mapDup(e: unknown, msg: string): Error {
  if (
    e instanceof Prisma.PrismaClientKnownRequestError &&
    e.code === 'P2002'
  ) {
    return new ConflictException(msg);
  }
  return e as Error;
}

function toResponse(n: {
  id: string;
  cityId: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}): NeighborhoodResponse {
  return {
    id: n.id,
    cityId: n.cityId,
    name: n.name,
    createdAt: n.createdAt.toISOString(),
    updatedAt: n.updatedAt.toISOString(),
  };
}
