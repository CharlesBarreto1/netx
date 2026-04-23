import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import {
  paginationMeta,
  type ActivityResponse,
  type CancelActivityRequest,
  type CompleteActivityRequest,
  type CreateActivityRequest,
  type ListActivitiesQuery,
  type Paginated,
  type UpdateActivityRequest,
} from '@netx/shared';

import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class ActivitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------------------
  // CREATE
  // ---------------------------------------------------------------------------
  async create(
    tenantId: string,
    actorUserId: string,
    input: CreateActivityRequest,
  ): Promise<ActivityResponse> {
    if (!input.dealId && !input.customerId) {
      throw new BadRequestException('Informe ao menos dealId ou customerId');
    }
    // valida posse
    if (input.dealId) {
      const d = await this.prisma.deal.findFirst({
        where: { id: input.dealId, tenantId, deletedAt: null },
        select: { id: true, customerId: true },
      });
      if (!d) throw new NotFoundException('Deal informado não existe');
      if (!input.customerId && d.customerId) input.customerId = d.customerId;
    }
    if (input.customerId) {
      const c = await this.prisma.customer.findFirst({
        where: { id: input.customerId, tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!c) throw new NotFoundException('Cliente informado não existe');
    }

    const row = await this.prisma.activity.create({
      data: {
        tenantId,
        type: input.type,
        title: input.title,
        notes: input.notes ?? null,
        location: input.location ?? null,
        durationMin: input.durationMin ?? null,
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
        dealId: input.dealId ?? null,
        customerId: input.customerId ?? null,
        ownerId: input.ownerId ?? actorUserId,
        createdById: actorUserId,
      },
      include: defaultInclude(),
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'crm.activity.created',
      resource: 'activities',
      resourceId: row.id,
      afterState: { type: row.type, title: row.title, dealId: row.dealId, customerId: row.customerId },
    });
    return toActivityResponse(row);
  }

  // ---------------------------------------------------------------------------
  // LIST
  // ---------------------------------------------------------------------------
  async list(tenantId: string, q: ListActivitiesQuery): Promise<Paginated<ActivityResponse>> {
    const now = new Date();
    const startOfToday = startOfDay(now);
    const endOfToday = endOfDay(now);
    const startOfTomorrow = addDays(startOfToday, 1);
    const endOfTomorrow = addDays(endOfToday, 1);
    const endOfWeek = endOfDay(addDays(startOfToday, 6));

    let dueGte: Date | undefined;
    let dueLte: Date | undefined;
    let statusScope: 'PENDING' | undefined;

    switch (q.scope) {
      case 'overdue':
        dueLte = startOfToday;
        statusScope = 'PENDING';
        break;
      case 'today':
        dueGte = startOfToday;
        dueLte = endOfToday;
        break;
      case 'tomorrow':
        dueGte = startOfTomorrow;
        dueLte = endOfTomorrow;
        break;
      case 'this-week':
        dueGte = startOfToday;
        dueLte = endOfWeek;
        break;
      case 'upcoming':
        dueGte = now;
        break;
    }
    if (q.dueFrom) dueGte = new Date(q.dueFrom);
    if (q.dueTo) dueLte = new Date(q.dueTo);

    const where: Prisma.ActivityWhereInput = {
      tenantId,
      deletedAt: null,
      ...(q.dealId ? { dealId: q.dealId } : {}),
      ...(q.customerId ? { customerId: q.customerId } : {}),
      ...(q.ownerId ? { ownerId: q.ownerId } : {}),
      ...(q.type ? { type: q.type } : {}),
      ...(q.status ? { status: q.status } : statusScope ? { status: statusScope } : {}),
      ...(dueGte || dueLte
        ? { dueAt: { ...(dueGte ? { gte: dueGte } : {}), ...(dueLte ? { lte: dueLte } : {}) } }
        : {}),
      ...(q.search
        ? {
            OR: [
              { title: { contains: q.search, mode: 'insensitive' } },
              { notes: { contains: q.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.activity.findMany({
        where,
        include: defaultInclude(),
        orderBy: { [q.sortBy]: q.sortDir },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.activity.count({ where }),
    ]);

    return {
      data: rows.map(toActivityResponse),
      pagination: paginationMeta(total, q.page, q.pageSize),
    };
  }

  // ---------------------------------------------------------------------------
  // FIND ONE
  // ---------------------------------------------------------------------------
  async findById(tenantId: string, id: string): Promise<ActivityResponse> {
    const row = await this.prisma.activity.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: defaultInclude(),
    });
    if (!row) throw new NotFoundException('Atividade não encontrada');
    return toActivityResponse(row);
  }

  // ---------------------------------------------------------------------------
  // UPDATE
  // ---------------------------------------------------------------------------
  async update(
    tenantId: string,
    actorUserId: string,
    id: string,
    input: UpdateActivityRequest,
  ): Promise<ActivityResponse> {
    const before = await this.prisma.activity.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!before) throw new NotFoundException('Atividade não encontrada');

    const updated = await this.prisma.activity.update({
      where: { id },
      data: {
        type: input.type,
        title: input.title,
        notes: input.notes,
        location: input.location,
        durationMin: input.durationMin,
        dueAt:
          input.dueAt === undefined ? undefined : input.dueAt === null ? null : new Date(input.dueAt),
        ownerId: input.ownerId,
      },
      include: defaultInclude(),
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'crm.activity.updated',
      resource: 'activities',
      resourceId: id,
      beforeState: { title: before.title },
      afterState: { title: updated.title },
    });
    return toActivityResponse(updated);
  }

  // ---------------------------------------------------------------------------
  // COMPLETE / CANCEL / REOPEN
  // ---------------------------------------------------------------------------
  async complete(
    tenantId: string,
    actorUserId: string,
    id: string,
    input: CompleteActivityRequest,
  ): Promise<ActivityResponse> {
    const before = await this.prisma.activity.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!before) throw new NotFoundException('Atividade não encontrada');
    if (before.status === 'DONE') return toActivityResponse(await this.withInclude(id));

    const completedAt = input.completedAt ? new Date(input.completedAt) : new Date();

    const updated = await this.prisma.activity.update({
      where: { id },
      data: {
        status: 'DONE',
        completedAt,
        completedById: actorUserId,
        notes: input.outcome
          ? before.notes
            ? `${before.notes}\n---\n${input.outcome}`
            : input.outcome
          : before.notes,
      },
      include: defaultInclude(),
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'crm.activity.completed',
      resource: 'activities',
      resourceId: id,
    });
    return toActivityResponse(updated);
  }

  async cancel(
    tenantId: string,
    actorUserId: string,
    id: string,
    input: CancelActivityRequest,
  ): Promise<ActivityResponse> {
    const before = await this.prisma.activity.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!before) throw new NotFoundException('Atividade não encontrada');

    const updated = await this.prisma.activity.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        notes: input.reason
          ? before.notes
            ? `${before.notes}\n---\nCancelada: ${input.reason}`
            : `Cancelada: ${input.reason}`
          : before.notes,
      },
      include: defaultInclude(),
    });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'crm.activity.cancelled',
      resource: 'activities',
      resourceId: id,
    });
    return toActivityResponse(updated);
  }

  async reopen(tenantId: string, actorUserId: string, id: string): Promise<ActivityResponse> {
    const before = await this.prisma.activity.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!before) throw new NotFoundException('Atividade não encontrada');

    const updated = await this.prisma.activity.update({
      where: { id },
      data: { status: 'PENDING', completedAt: null, completedById: null },
      include: defaultInclude(),
    });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'crm.activity.reopened',
      resource: 'activities',
      resourceId: id,
    });
    return toActivityResponse(updated);
  }

  // ---------------------------------------------------------------------------
  // DELETE
  // ---------------------------------------------------------------------------
  async remove(tenantId: string, actorUserId: string, id: string): Promise<void> {
    const before = await this.prisma.activity.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!before) throw new NotFoundException('Atividade não encontrada');
    await this.prisma.activity.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'crm.activity.deleted',
      resource: 'activities',
      resourceId: id,
    });
  }

  // ---------------------------------------------------------------------------
  private async withInclude(id: string): Promise<ActivityRow> {
    const row = await this.prisma.activity.findUniqueOrThrow({
      where: { id },
      include: defaultInclude(),
    });
    return row;
  }
}

// =============================================================================
// Helpers
// =============================================================================
function defaultInclude() {
  return {
    deal: { select: { id: true, title: true } },
    customer: { select: { id: true, displayName: true } },
    owner: { select: { id: true, firstName: true, lastName: true } },
    createdBy: { select: { id: true, firstName: true, lastName: true } },
    completedBy: { select: { id: true, firstName: true, lastName: true } },
  } satisfies Prisma.ActivityInclude;
}

function fullName(u: { firstName: string; lastName: string } | null | undefined): string {
  if (!u) return '';
  return `${u.firstName} ${u.lastName}`.trim();
}
type ActivityRow = Prisma.ActivityGetPayload<{ include: ReturnType<typeof defaultInclude> }>;

function toActivityResponse(a: ActivityRow): ActivityResponse {
  return {
    id: a.id,
    tenantId: a.tenantId,
    type: a.type,
    status: a.status,
    title: a.title,
    notes: a.notes,
    location: a.location,
    durationMin: a.durationMin,
    dueAt: a.dueAt ? a.dueAt.toISOString() : null,
    completedAt: a.completedAt ? a.completedAt.toISOString() : null,
    dealId: a.dealId,
    customerId: a.customerId,
    ownerId: a.ownerId,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
    deletedAt: a.deletedAt ? a.deletedAt.toISOString() : null,
    deal: a.deal ? { id: a.deal.id, title: a.deal.title } : null,
    customer: a.customer ? { id: a.customer.id, displayName: a.customer.displayName } : null,
    owner: a.owner ? { id: a.owner.id, name: fullName(a.owner) } : null,
    createdBy: a.createdBy ? { id: a.createdBy.id, name: fullName(a.createdBy) } : undefined,
    completedBy: a.completedBy ? { id: a.completedBy.id, name: fullName(a.completedBy) } : null,
  };
}

function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}
function endOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(23, 59, 59, 999);
  return r;
}
function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
