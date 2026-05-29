import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MaintenanceKind, Prisma } from '@prisma/client';

import {
  paginationMeta,
  type CreateMaintenancePlanRequest,
  type CreateMaintenanceRecordRequest,
  type ListMaintenancePlansQuery,
  type ListMaintenanceRecordsQuery,
  type MaintenanceDueStatus,
  type MaintenancePlanResponse,
  type MaintenanceRecordResponse,
  type Paginated,
  type UpdateMaintenancePlanRequest,
} from '@netx/shared';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

// Janelas de alerta — quando o veículo entra nelas, o plano vira DUE_SOON.
const DUE_SOON_KM = 1000;
const DUE_SOON_DAYS = 30;
const DAY_MS = 86_400_000;

const planInclude = {
  vehicle: { select: { id: true, plate: true, odometer: true } },
} satisfies Prisma.MaintenancePlanInclude;

type PlanWithVehicle = Prisma.MaintenancePlanGetPayload<{
  include: typeof planInclude;
}>;

const recordInclude = {
  vehicle: { select: { id: true, plate: true } },
} satisfies Prisma.MaintenanceRecordInclude;

type RecordWithVehicle = Prisma.MaintenanceRecordGetPayload<{
  include: typeof recordInclude;
}>;

@Injectable()
export class MaintenanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ===========================================================================
  // PLANS (preventiva)
  // ===========================================================================
  async listPlans(
    tenantId: string,
    q: ListMaintenancePlansQuery,
  ): Promise<Paginated<MaintenancePlanResponse>> {
    const where: Prisma.MaintenancePlanWhereInput = {
      tenantId,
      deletedAt: null,
      ...(q.vehicleId ? { vehicleId: q.vehicleId } : {}),
      ...(q.active !== undefined ? { active: q.active } : {}),
    };

    // dueOnly depende do status calculado (vs. odômetro atual + hoje), então
    // buscamos tudo, computamos, filtramos e paginamos em memória. Frota é
    // pequena (dezenas de veículos), custo desprezível.
    if (q.dueOnly) {
      const all = await this.prisma.maintenancePlan.findMany({
        where,
        include: planInclude,
        take: 2000,
      });
      const mapped = all
        .map(toPlanResponse)
        .filter((p) => p.dueStatus === 'OVERDUE' || p.dueStatus === 'DUE_SOON');
      mapped.sort(byDueStatus(q.sortDir));
      const start = (q.page - 1) * q.pageSize;
      return {
        data: mapped.slice(start, start + q.pageSize),
        pagination: paginationMeta(mapped.length, q.page, q.pageSize),
      };
    }

    const orderBy: Prisma.MaintenancePlanOrderByWithRelationInput =
      q.sortBy === 'nextDueDate'
        ? { nextDueDate: { sort: q.sortDir, nulls: 'last' } }
        : { createdAt: q.sortDir };

    const [rows, total] = await Promise.all([
      this.prisma.maintenancePlan.findMany({
        where,
        include: planInclude,
        orderBy,
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.maintenancePlan.count({ where }),
    ]);

    return {
      data: rows.map(toPlanResponse),
      pagination: paginationMeta(total, q.page, q.pageSize),
    };
  }

  async findPlan(tenantId: string, id: string): Promise<MaintenancePlanResponse> {
    const p = await this.prisma.maintenancePlan.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: planInclude,
    });
    if (!p) throw new NotFoundException('Plano de manutenção não encontrado');
    return toPlanResponse(p);
  }

  async createPlan(
    tenantId: string,
    actorUserId: string,
    input: CreateMaintenancePlanRequest,
  ): Promise<MaintenancePlanResponse> {
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id: input.vehicleId, tenantId, deletedAt: null },
      select: { id: true, odometer: true },
    });
    if (!vehicle) throw new NotFoundException('Veículo não encontrado');

    // Marco do último serviço: usa o informado ou o estado atual do veículo/hoje.
    const lastServiceOdometer = input.lastServiceOdometer ?? vehicle.odometer;
    const lastServiceDate = input.lastServiceDate
      ? new Date(input.lastServiceDate)
      : startOfToday();

    const next = computeNextDue({
      intervalKm: input.intervalKm ?? null,
      intervalDays: input.intervalDays ?? null,
      lastServiceOdometer,
      lastServiceDate,
    });

    const p = await this.prisma.maintenancePlan.create({
      data: {
        tenantId,
        vehicleId: input.vehicleId,
        kind: input.kind as MaintenanceKind,
        description: input.description ?? null,
        intervalKm: input.intervalKm ?? null,
        intervalDays: input.intervalDays ?? null,
        lastServiceOdometer,
        lastServiceDate,
        nextDueOdometer: next.nextDueOdometer,
        nextDueDate: next.nextDueDate,
        active: input.active,
        createdById: actorUserId,
      },
      include: planInclude,
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'maintenance_plan.created',
      resource: 'maintenance_plans',
      resourceId: p.id,
      afterState: { vehicleId: input.vehicleId, kind: input.kind },
    });

    return toPlanResponse(p);
  }

  async updatePlan(
    tenantId: string,
    actorUserId: string,
    id: string,
    input: UpdateMaintenancePlanRequest,
  ): Promise<MaintenancePlanResponse> {
    const before = await this.prisma.maintenancePlan.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!before) throw new NotFoundException('Plano de manutenção não encontrado');

    // Estado final após o patch.
    const intervalKm = input.intervalKm !== undefined ? input.intervalKm : before.intervalKm;
    const intervalDays =
      input.intervalDays !== undefined ? input.intervalDays : before.intervalDays;
    if (intervalKm == null && intervalDays == null) {
      throw new BadRequestException('Informe ao menos um intervalo (km ou dias).');
    }
    const lastServiceOdometer =
      input.lastServiceOdometer !== undefined
        ? input.lastServiceOdometer
        : before.lastServiceOdometer;
    const lastServiceDate =
      input.lastServiceDate !== undefined
        ? input.lastServiceDate
          ? new Date(input.lastServiceDate)
          : null
        : before.lastServiceDate;

    const next = computeNextDue({
      intervalKm,
      intervalDays,
      lastServiceOdometer,
      lastServiceDate,
    });

    const p = await this.prisma.maintenancePlan.update({
      where: { id },
      data: {
        ...(input.kind !== undefined ? { kind: input.kind as MaintenanceKind } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        intervalKm,
        intervalDays,
        lastServiceOdometer,
        lastServiceDate,
        nextDueOdometer: next.nextDueOdometer,
        nextDueDate: next.nextDueDate,
        ...(input.active !== undefined ? { active: input.active } : {}),
      },
      include: planInclude,
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'maintenance_plan.updated',
      resource: 'maintenance_plans',
      resourceId: id,
      afterState: { kind: p.kind, active: p.active },
    });

    return toPlanResponse(p);
  }

  async removePlan(tenantId: string, actorUserId: string, id: string): Promise<void> {
    const before = await this.prisma.maintenancePlan.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!before) throw new NotFoundException('Plano de manutenção não encontrado');

    await this.prisma.maintenancePlan.update({
      where: { id },
      data: { deletedAt: new Date(), active: false },
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'maintenance_plan.deleted',
      resource: 'maintenance_plans',
      resourceId: id,
    });
  }

  // ===========================================================================
  // RECORDS (executada) — avança o plano vinculado
  // ===========================================================================
  async listRecords(
    tenantId: string,
    q: ListMaintenanceRecordsQuery,
  ): Promise<Paginated<MaintenanceRecordResponse>> {
    const where: Prisma.MaintenanceRecordWhereInput = {
      tenantId,
      deletedAt: null,
      ...(q.vehicleId ? { vehicleId: q.vehicleId } : {}),
      ...(q.planId ? { planId: q.planId } : {}),
      ...(q.from || q.to
        ? {
            performedAt: {
              ...(q.from ? { gte: new Date(q.from) } : {}),
              ...(q.to ? { lte: new Date(q.to) } : {}),
            },
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.maintenanceRecord.findMany({
        where,
        include: recordInclude,
        orderBy: { [q.sortBy]: q.sortDir },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.maintenanceRecord.count({ where }),
    ]);

    return {
      data: rows.map(toRecordResponse),
      pagination: paginationMeta(total, q.page, q.pageSize),
    };
  }

  async createRecord(
    tenantId: string,
    actorUserId: string,
    input: CreateMaintenanceRecordRequest,
  ): Promise<MaintenanceRecordResponse> {
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id: input.vehicleId, tenantId, deletedAt: null },
      select: { id: true, odometer: true },
    });
    if (!vehicle) throw new NotFoundException('Veículo não encontrado');

    let plan: { id: string; intervalKm: number | null; intervalDays: number | null } | null =
      null;
    if (input.planId) {
      const p = await this.prisma.maintenancePlan.findFirst({
        where: { id: input.planId, tenantId, deletedAt: null, vehicleId: input.vehicleId },
        select: { id: true, intervalKm: true, intervalDays: true },
      });
      if (!p) {
        throw new NotFoundException('Plano não encontrado para este veículo');
      }
      plan = p;
    }

    const performedAt = new Date(input.performedAt);
    const recordOdometer = input.odometer ?? null;

    const id = await this.prisma.$transaction(async (tx) => {
      const rec = await tx.maintenanceRecord.create({
        data: {
          tenantId,
          vehicleId: input.vehicleId,
          planId: input.planId ?? null,
          kind: input.kind as MaintenanceKind,
          performedAt,
          odometer: recordOdometer,
          cost: input.cost != null ? new Prisma.Decimal(input.cost) : null,
          workshop: input.workshop ?? null,
          description: input.description ?? null,
          createdById: actorUserId,
        },
      });

      // Mantém o odômetro do veículo atualizado se o registro for mais novo.
      if (recordOdometer != null && recordOdometer > vehicle.odometer) {
        await tx.vehicle.update({
          where: { id: input.vehicleId },
          data: { odometer: recordOdometer },
        });
      }

      // Avança o marco do plano e recalcula o próximo vencimento.
      if (plan) {
        const lastServiceOdometer = recordOdometer ?? vehicle.odometer;
        const next = computeNextDue({
          intervalKm: plan.intervalKm,
          intervalDays: plan.intervalDays,
          lastServiceOdometer,
          lastServiceDate: performedAt,
        });
        await tx.maintenancePlan.update({
          where: { id: plan.id },
          data: {
            lastServiceOdometer,
            lastServiceDate: performedAt,
            nextDueOdometer: next.nextDueOdometer,
            nextDueDate: next.nextDueDate,
          },
        });
      }

      return rec.id;
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'maintenance_record.created',
      resource: 'maintenance_records',
      resourceId: id,
      afterState: { vehicleId: input.vehicleId, kind: input.kind, planId: input.planId ?? null },
    });

    const rec = await this.prisma.maintenanceRecord.findFirstOrThrow({
      where: { id, tenantId },
      include: recordInclude,
    });
    return toRecordResponse(rec);
  }
}

// =============================================================================
// HELPERS
// =============================================================================
function startOfToday(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function computeNextDue(input: {
  intervalKm: number | null;
  intervalDays: number | null;
  lastServiceOdometer: number | null;
  lastServiceDate: Date | null;
}): { nextDueOdometer: number | null; nextDueDate: Date | null } {
  const nextDueOdometer =
    input.intervalKm != null && input.lastServiceOdometer != null
      ? input.lastServiceOdometer + input.intervalKm
      : null;
  const nextDueDate =
    input.intervalDays != null && input.lastServiceDate != null
      ? new Date(input.lastServiceDate.getTime() + input.intervalDays * DAY_MS)
      : null;
  return { nextDueOdometer, nextDueDate };
}

function dateOnly(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

function byDueStatus(
  dir: 'asc' | 'desc',
): (a: MaintenancePlanResponse, b: MaintenancePlanResponse) => number {
  const rank: Record<MaintenanceDueStatus, number> = {
    OVERDUE: 0,
    DUE_SOON: 1,
    OK: 2,
    UNKNOWN: 3,
  };
  const sign = dir === 'desc' ? -1 : 1;
  return (a, b) => sign * (rank[a.dueStatus] - rank[b.dueStatus]);
}

function toPlanResponse(p: PlanWithVehicle): MaintenancePlanResponse {
  const odometer = p.vehicle?.odometer ?? null;
  const now = Date.now();

  let kmRemaining: number | null = null;
  let daysRemaining: number | null = null;
  let status: MaintenanceDueStatus = 'UNKNOWN';

  const rank: Record<MaintenanceDueStatus, number> = {
    OVERDUE: 0,
    DUE_SOON: 1,
    OK: 2,
    UNKNOWN: 3,
  };
  const worst = (a: MaintenanceDueStatus, b: MaintenanceDueStatus) =>
    rank[a] < rank[b] ? a : b;

  if (p.nextDueOdometer != null && odometer != null) {
    kmRemaining = p.nextDueOdometer - odometer;
    const s: MaintenanceDueStatus =
      kmRemaining <= 0 ? 'OVERDUE' : kmRemaining <= DUE_SOON_KM ? 'DUE_SOON' : 'OK';
    status = worst(status, s);
  }
  if (p.nextDueDate != null) {
    daysRemaining = Math.ceil((p.nextDueDate.getTime() - now) / DAY_MS);
    const s: MaintenanceDueStatus =
      daysRemaining <= 0 ? 'OVERDUE' : daysRemaining <= DUE_SOON_DAYS ? 'DUE_SOON' : 'OK';
    status = worst(status, s);
  }

  return {
    id: p.id,
    tenantId: p.tenantId,
    vehicleId: p.vehicleId,
    kind: p.kind,
    description: p.description,
    intervalKm: p.intervalKm,
    intervalDays: p.intervalDays,
    lastServiceOdometer: p.lastServiceOdometer,
    lastServiceDate: dateOnly(p.lastServiceDate),
    nextDueOdometer: p.nextDueOdometer,
    nextDueDate: dateOnly(p.nextDueDate),
    active: p.active,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    dueStatus: status,
    kmRemaining,
    daysRemaining,
    vehicle: p.vehicle
      ? { id: p.vehicle.id, plate: p.vehicle.plate, odometer: p.vehicle.odometer }
      : null,
  };
}

function toRecordResponse(r: RecordWithVehicle): MaintenanceRecordResponse {
  return {
    id: r.id,
    tenantId: r.tenantId,
    vehicleId: r.vehicleId,
    planId: r.planId,
    kind: r.kind,
    performedAt: dateOnly(r.performedAt)!,
    odometer: r.odometer,
    cost: r.cost != null ? Number(r.cost) : null,
    workshop: r.workshop,
    description: r.description,
    createdById: r.createdById,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    vehicle: r.vehicle ? { id: r.vehicle.id, plate: r.vehicle.plate } : null,
  };
}
