import { Injectable, NotFoundException } from '@nestjs/common';
import { DriverStatus, Prisma } from '@prisma/client';

import {
  paginationMeta,
  type CreateDriverRequest,
  type DriverResponse,
  type ListDriversQuery,
  type Paginated,
  type UpdateDriverRequest,
} from '@netx/shared';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DriversService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    tenantId: string,
    q: ListDriversQuery,
  ): Promise<Paginated<DriverResponse>> {
    const where: Prisma.DriverWhereInput = {
      tenantId,
      deletedAt: null,
      ...(q.status ? { status: q.status as DriverStatus } : {}),
      ...(q.search
        ? {
            OR: [
              { name: { contains: q.search, mode: 'insensitive' } },
              { document: { contains: q.search, mode: 'insensitive' } },
              { phone: { contains: q.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.driver.findMany({
        where,
        orderBy: { [q.sortBy]: q.sortDir },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.driver.count({ where }),
    ]);

    return {
      data: rows.map(toDriverResponse),
      pagination: paginationMeta(total, q.page, q.pageSize),
    };
  }

  async findById(tenantId: string, id: string): Promise<DriverResponse> {
    const d = await this.prisma.driver.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!d) throw new NotFoundException('Motorista não encontrado');
    return toDriverResponse(d);
  }

  async create(
    tenantId: string,
    actorUserId: string,
    input: CreateDriverRequest,
  ): Promise<DriverResponse> {
    if (input.userId) await this.assertUser(tenantId, input.userId);

    const d = await this.prisma.driver.create({
      data: {
        tenantId,
        name: input.name,
        document: input.document ?? null,
        licenseNumber: input.licenseNumber ?? null,
        licenseCategory: input.licenseCategory ?? null,
        licenseExpiry: input.licenseExpiry ? new Date(input.licenseExpiry) : null,
        phone: input.phone ?? null,
        status: input.status as DriverStatus,
        userId: input.userId ?? null,
        notes: input.notes ?? null,
        createdById: actorUserId,
      },
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'driver.created',
      resource: 'drivers',
      resourceId: d.id,
      afterState: { name: d.name },
    });

    return toDriverResponse(d);
  }

  async update(
    tenantId: string,
    actorUserId: string,
    id: string,
    input: UpdateDriverRequest,
  ): Promise<DriverResponse> {
    const before = await this.prisma.driver.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!before) throw new NotFoundException('Motorista não encontrado');

    if (input.userId) await this.assertUser(tenantId, input.userId);

    const d = await this.prisma.driver.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.document !== undefined ? { document: input.document } : {}),
        ...(input.licenseNumber !== undefined
          ? { licenseNumber: input.licenseNumber }
          : {}),
        ...(input.licenseCategory !== undefined
          ? { licenseCategory: input.licenseCategory }
          : {}),
        ...(input.licenseExpiry !== undefined
          ? { licenseExpiry: input.licenseExpiry ? new Date(input.licenseExpiry) : null }
          : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.status !== undefined ? { status: input.status as DriverStatus } : {}),
        ...(input.userId !== undefined ? { userId: input.userId } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        updatedById: actorUserId,
      },
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'driver.updated',
      resource: 'drivers',
      resourceId: id,
      beforeState: { name: before.name, status: before.status },
      afterState: { name: d.name, status: d.status },
    });

    return toDriverResponse(d);
  }

  async remove(tenantId: string, actorUserId: string, id: string): Promise<void> {
    const before = await this.prisma.driver.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!before) throw new NotFoundException('Motorista não encontrado');

    // Desvincula de veículos onde é o motorista atual antes do soft-delete.
    await this.prisma.$transaction([
      this.prisma.vehicle.updateMany({
        where: { tenantId, currentDriverId: id },
        data: { currentDriverId: null },
      }),
      this.prisma.driver.update({
        where: { id },
        data: { deletedAt: new Date(), status: DriverStatus.INACTIVE },
      }),
    ]);

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'driver.deleted',
      resource: 'drivers',
      resourceId: id,
      beforeState: { name: before.name },
    });
  }

  private async assertUser(tenantId: string, userId: string): Promise<void> {
    const u = await this.prisma.user.findFirst({
      where: { id: userId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!u) throw new NotFoundException('Usuário vinculado não encontrado');
  }
}

function toDriverResponse(d: {
  id: string;
  tenantId: string;
  name: string;
  document: string | null;
  licenseNumber: string | null;
  licenseCategory: string | null;
  licenseExpiry: Date | null;
  phone: string | null;
  status: DriverStatus;
  userId: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}): DriverResponse {
  return {
    id: d.id,
    tenantId: d.tenantId,
    name: d.name,
    document: d.document,
    licenseNumber: d.licenseNumber,
    licenseCategory: d.licenseCategory,
    licenseExpiry: d.licenseExpiry ? d.licenseExpiry.toISOString().slice(0, 10) : null,
    phone: d.phone,
    status: d.status,
    userId: d.userId,
    notes: d.notes,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}
