import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, VehicleStatus, VehicleType } from '@prisma/client';

import {
  paginationMeta,
  type CreateVehicleRequest,
  type ListVehiclesQuery,
  type Paginated,
  type UpdateVehicleRequest,
  type VehicleResponse,
} from '@netx/shared';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

const vehicleInclude = {
  currentDriver: { select: { id: true, name: true } },
} satisfies Prisma.VehicleInclude;

type VehicleWithRelations = Prisma.VehicleGetPayload<{
  include: typeof vehicleInclude;
}>;

@Injectable()
export class VehiclesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    tenantId: string,
    q: ListVehiclesQuery,
  ): Promise<Paginated<VehicleResponse>> {
    const where: Prisma.VehicleWhereInput = {
      tenantId,
      deletedAt: null,
      ...(q.status ? { status: q.status as VehicleStatus } : {}),
      ...(q.type ? { type: q.type as VehicleType } : {}),
      ...(q.hasTracker !== undefined
        ? { trackerUniqueId: q.hasTracker ? { not: null } : null }
        : {}),
      ...(q.search
        ? {
            OR: [
              { plate: { contains: q.search, mode: 'insensitive' } },
              { brand: { contains: q.search, mode: 'insensitive' } },
              { model: { contains: q.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.vehicle.findMany({
        where,
        include: vehicleInclude,
        orderBy: { [q.sortBy]: q.sortDir },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.vehicle.count({ where }),
    ]);

    return {
      data: rows.map(toVehicleResponse),
      pagination: paginationMeta(total, q.page, q.pageSize),
    };
  }

  async findById(tenantId: string, id: string): Promise<VehicleResponse> {
    const v = await this.prisma.vehicle.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: vehicleInclude,
    });
    if (!v) throw new NotFoundException('Veículo não encontrado');
    return toVehicleResponse(v);
  }

  async create(
    tenantId: string,
    actorUserId: string,
    input: CreateVehicleRequest,
  ): Promise<VehicleResponse> {
    if (input.currentDriverId) {
      await this.assertDriver(tenantId, input.currentDriverId);
    }

    try {
      const v = await this.prisma.vehicle.create({
        data: {
          tenantId,
          plate: input.plate,
          brand: input.brand ?? null,
          model: input.model ?? null,
          year: input.year ?? null,
          type: input.type as VehicleType,
          color: input.color ?? null,
          renavam: input.renavam ?? null,
          chassis: input.chassis ?? null,
          status: input.status as VehicleStatus,
          trackerUniqueId: input.trackerUniqueId ?? null,
          odometer: input.odometer,
          notes: input.notes ?? null,
          currentDriverId: input.currentDriverId ?? null,
          createdById: actorUserId,
        },
        include: vehicleInclude,
      });

      await this.audit.log({
        tenantId,
        userId: actorUserId,
        action: 'vehicle.created',
        resource: 'vehicles',
        resourceId: v.id,
        afterState: { plate: v.plate, trackerUniqueId: v.trackerUniqueId },
      });

      return toVehicleResponse(v);
    } catch (e) {
      throw this.mapUniqueError(e, input);
    }
  }

  async update(
    tenantId: string,
    actorUserId: string,
    id: string,
    input: UpdateVehicleRequest,
  ): Promise<VehicleResponse> {
    const before = await this.prisma.vehicle.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!before) throw new NotFoundException('Veículo não encontrado');

    if (input.currentDriverId) {
      await this.assertDriver(tenantId, input.currentDriverId);
    }

    try {
      const v = await this.prisma.vehicle.update({
        where: { id },
        data: {
          ...(input.plate !== undefined ? { plate: input.plate } : {}),
          ...(input.brand !== undefined ? { brand: input.brand } : {}),
          ...(input.model !== undefined ? { model: input.model } : {}),
          ...(input.year !== undefined ? { year: input.year } : {}),
          ...(input.type !== undefined ? { type: input.type as VehicleType } : {}),
          ...(input.color !== undefined ? { color: input.color } : {}),
          ...(input.renavam !== undefined ? { renavam: input.renavam } : {}),
          ...(input.chassis !== undefined ? { chassis: input.chassis } : {}),
          ...(input.status !== undefined
            ? { status: input.status as VehicleStatus }
            : {}),
          ...(input.trackerUniqueId !== undefined
            ? { trackerUniqueId: input.trackerUniqueId }
            : {}),
          ...(input.odometer !== undefined ? { odometer: input.odometer } : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          ...(input.currentDriverId !== undefined
            ? { currentDriverId: input.currentDriverId }
            : {}),
          updatedById: actorUserId,
        },
        include: vehicleInclude,
      });

      await this.audit.log({
        tenantId,
        userId: actorUserId,
        action: 'vehicle.updated',
        resource: 'vehicles',
        resourceId: id,
        beforeState: { plate: before.plate, status: before.status },
        afterState: { plate: v.plate, status: v.status },
      });

      return toVehicleResponse(v);
    } catch (e) {
      throw this.mapUniqueError(e, input);
    }
  }

  async remove(tenantId: string, actorUserId: string, id: string): Promise<void> {
    const before = await this.prisma.vehicle.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!before) throw new NotFoundException('Veículo não encontrado');

    await this.prisma.vehicle.update({
      where: { id },
      data: { deletedAt: new Date(), status: VehicleStatus.INACTIVE },
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'vehicle.deleted',
      resource: 'vehicles',
      resourceId: id,
      beforeState: { plate: before.plate },
    });
  }

  private async assertDriver(tenantId: string, driverId: string): Promise<void> {
    const d = await this.prisma.driver.findFirst({
      where: { id: driverId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!d) throw new NotFoundException('Motorista não encontrado');
  }

  private mapUniqueError(
    e: unknown,
    input: CreateVehicleRequest | UpdateVehicleRequest,
  ): unknown {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const target = (e.meta?.target as string[] | undefined) ?? [];
      if (target.includes('tracker_unique_id') || target.some((t) => t.includes('tracker'))) {
        return new ConflictException(
          `Já existe um veículo com o rastreador ${input.trackerUniqueId ?? ''}`,
        );
      }
      return new ConflictException(`Já existe um veículo com a placa ${input.plate ?? ''}`);
    }
    return e;
  }
}

function toVehicleResponse(v: VehicleWithRelations): VehicleResponse {
  return {
    id: v.id,
    tenantId: v.tenantId,
    plate: v.plate,
    brand: v.brand,
    model: v.model,
    year: v.year,
    type: v.type,
    color: v.color,
    renavam: v.renavam,
    chassis: v.chassis,
    status: v.status,
    trackerUniqueId: v.trackerUniqueId,
    odometer: v.odometer,
    notes: v.notes,
    currentDriverId: v.currentDriverId,
    createdAt: v.createdAt.toISOString(),
    updatedAt: v.updatedAt.toISOString(),
    currentDriver: v.currentDriver
      ? { id: v.currentDriver.id, name: v.currentDriver.name }
      : null,
  };
}
