import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, TimeEntrySource, TimeEntryType } from '@prisma/client';
import {
  paginationMeta,
  type ClockInOut,
  type CreateTimeCorrection,
  type CreateTimeEntry,
  type UpdateTimeEntry,
  type ListTimeCorrectionsQuery,
  type ListTimeEntriesQuery,
  type Paginated,
  type ReviewTimeCorrection,
  type TimeCorrectionResponse,
  type TimeEntryResponse,
  type TimesheetDay,
  type TimesheetResponse,
} from '@netx/shared';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TimeclockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── Marcações ────────────────────────────────────────────────────────────
  async clock(
    tenantId: string,
    employeeId: string,
    body: ClockInOut,
    ctx: { source?: TimeEntrySource; ipAddress?: string | null; actorUserId?: string },
  ): Promise<TimeEntryResponse> {
    await this.assertEmployee(tenantId, employeeId);
    const entry = await this.prisma.timeEntry.create({
      data: {
        tenantId,
        employeeId,
        type: body.type as TimeEntryType,
        occurredAt: new Date(),
        source: ctx.source ?? TimeEntrySource.PORTAL,
        latitude: body.latitude ?? null,
        longitude: body.longitude ?? null,
        ipAddress: ctx.ipAddress ?? null,
        createdById: ctx.actorUserId ?? null,
      },
    });
    return toEntryResponse(entry);
  }

  /** Lançamento manual de marcação pelo RH (fora do fluxo de correção). */
  async createManualEntry(
    tenantId: string,
    actorUserId: string,
    input: CreateTimeEntry,
  ): Promise<TimeEntryResponse> {
    await this.assertEmployee(tenantId, input.employeeId);
    const entry = await this.prisma.timeEntry.create({
      data: {
        tenantId,
        employeeId: input.employeeId,
        type: input.type as TimeEntryType,
        occurredAt: new Date(input.occurredAt),
        source: TimeEntrySource.MANUAL,
        notes: input.notes ?? null,
        createdById: actorUserId,
      },
    });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'time_entry.created_manual',
      resource: 'time_entries',
      resourceId: entry.id,
      afterState: { employeeId: input.employeeId, type: input.type },
    });
    return toEntryResponse(entry);
  }

  /** Edita uma marcação lançada errada (hora/tipo/observação). */
  async updateEntry(
    tenantId: string,
    actorUserId: string,
    entryId: string,
    input: UpdateTimeEntry,
  ): Promise<TimeEntryResponse> {
    const before = await this.prisma.timeEntry.findFirst({
      where: { id: entryId, tenantId, deletedAt: null },
    });
    if (!before) throw new NotFoundException('Marcação não encontrada');
    const entry = await this.prisma.timeEntry.update({
      where: { id: entryId },
      data: {
        type: input.type ? (input.type as TimeEntryType) : undefined,
        occurredAt: input.occurredAt ? new Date(input.occurredAt) : undefined,
        notes: input.notes === undefined ? undefined : (input.notes ?? null),
      },
    });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'time_entry.updated',
      resource: 'time_entries',
      resourceId: entryId,
      beforeState: { occurredAt: before.occurredAt, type: before.type },
      afterState: { occurredAt: entry.occurredAt, type: entry.type },
    });
    return toEntryResponse(entry);
  }

  /** Exclui (soft-delete) uma marcação lançada errada. */
  async removeEntry(
    tenantId: string,
    actorUserId: string,
    entryId: string,
  ): Promise<void> {
    const before = await this.prisma.timeEntry.findFirst({
      where: { id: entryId, tenantId, deletedAt: null },
    });
    if (!before) throw new NotFoundException('Marcação não encontrada');
    await this.prisma.timeEntry.update({
      where: { id: entryId },
      data: { deletedAt: new Date() },
    });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'time_entry.deleted',
      resource: 'time_entries',
      resourceId: entryId,
      beforeState: { occurredAt: before.occurredAt, type: before.type, source: before.source },
    });
  }

  async listEntries(
    tenantId: string,
    q: ListTimeEntriesQuery,
  ): Promise<Paginated<TimeEntryResponse>> {
    const where: Prisma.TimeEntryWhereInput = {
      tenantId,
      deletedAt: null,
      ...(q.employeeId ? { employeeId: q.employeeId } : {}),
      ...(q.from || q.to
        ? {
            occurredAt: {
              ...(q.from ? { gte: new Date(q.from) } : {}),
              ...(q.to ? { lte: new Date(q.to) } : {}),
            },
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.timeEntry.findMany({
        where,
        include: { employee: { select: { id: true, fullName: true } } },
        orderBy: { occurredAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.timeEntry.count({ where }),
    ]);
    return {
      data: rows.map(toEntryResponse),
      pagination: paginationMeta(total, q.page, q.pageSize),
    };
  }

  // ── Espelho de ponto ──────────────────────────────────────────────────────
  async timesheet(
    tenantId: string,
    employeeId: string,
    fromDate: string,
    toDate: string,
  ): Promise<TimesheetResponse> {
    await this.assertEmployee(tenantId, employeeId);
    const tz = await this.tenantTimezone(tenantId);

    const from = new Date(`${fromDate}T00:00:00.000Z`);
    // Inclui o dia inteiro do `to` (+1 dia), margem de fuso coberta pelo agrupamento.
    const to = new Date(`${toDate}T23:59:59.999Z`);

    const entries = await this.prisma.timeEntry.findMany({
      where: {
        tenantId,
        employeeId,
        deletedAt: null,
        occurredAt: { gte: from, lte: to },
      },
      orderBy: { occurredAt: 'asc' },
    });

    const byDay = new Map<string, typeof entries>();
    for (const e of entries) {
      const day = dayKey(e.occurredAt, tz);
      const arr = byDay.get(day) ?? [];
      arr.push(e);
      byDay.set(day, arr);
    }

    const days: TimesheetDay[] = [];
    let totalWorkedMinutes = 0;
    for (const [date, dayEntries] of [...byDay.entries()].sort()) {
      const worked = computeWorkedMinutes(dayEntries);
      totalWorkedMinutes += worked;
      const ins = dayEntries.filter((e) => e.type === 'CLOCK_IN');
      const outs = dayEntries.filter((e) => e.type === 'CLOCK_OUT');
      days.push({
        date,
        entries: dayEntries.map((e) => ({
          id: e.id,
          type: e.type,
          occurredAt: e.occurredAt.toISOString(),
          source: e.source,
        })),
        workedMinutes: worked,
        firstIn: ins[0]?.occurredAt.toISOString() ?? null,
        lastOut: outs[outs.length - 1]?.occurredAt.toISOString() ?? null,
      });
    }

    return { employeeId, from: fromDate, to: toDate, days, totalWorkedMinutes };
  }

  // ── Correções ───────────────────────────────────────────────────────────
  async createCorrection(
    tenantId: string,
    employeeId: string,
    input: CreateTimeCorrection,
  ): Promise<TimeCorrectionResponse> {
    await this.assertEmployee(tenantId, employeeId);
    if (input.targetEntryId) {
      const exists = await this.prisma.timeEntry.findFirst({
        where: { id: input.targetEntryId, tenantId, employeeId, deletedAt: null },
        select: { id: true },
      });
      if (!exists) throw new NotFoundException('Marcação alvo não encontrada');
    }
    const req = await this.prisma.timeCorrectionRequest.create({
      data: {
        tenantId,
        employeeId,
        kind: input.kind,
        targetDate: new Date(`${input.targetDate}T00:00:00.000Z`),
        targetEntryId: input.targetEntryId ?? null,
        proposedType: (input.proposedType as TimeEntryType) ?? null,
        proposedTime: input.proposedTime ? new Date(input.proposedTime) : null,
        reason: input.reason,
      },
      include: { employee: { select: { id: true, fullName: true } } },
    });
    return toCorrectionResponse(req);
  }

  async listCorrections(
    tenantId: string,
    q: ListTimeCorrectionsQuery,
  ): Promise<Paginated<TimeCorrectionResponse>> {
    const where: Prisma.TimeCorrectionRequestWhereInput = {
      tenantId,
      ...(q.status ? { status: q.status } : {}),
      ...(q.employeeId ? { employeeId: q.employeeId } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.timeCorrectionRequest.findMany({
        where,
        include: { employee: { select: { id: true, fullName: true } } },
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.timeCorrectionRequest.count({ where }),
    ]);
    return {
      data: rows.map(toCorrectionResponse),
      pagination: paginationMeta(total, q.page, q.pageSize),
    };
  }

  /**
   * RH decide. APPROVED materializa a mudança no ponto numa transação:
   *  - ADD → cria TimeEntry MANUAL
   *  - EDIT → atualiza occurredAt/type da marcação alvo
   *  - REMOVE → soft-delete da marcação alvo
   */
  async reviewCorrection(
    tenantId: string,
    actorUserId: string,
    id: string,
    input: ReviewTimeCorrection,
  ): Promise<TimeCorrectionResponse> {
    const req = await this.prisma.timeCorrectionRequest.findFirst({
      where: { id, tenantId },
    });
    if (!req) throw new NotFoundException('Solicitação não encontrada');
    if (req.status !== 'PENDING') {
      throw new BadRequestException('Solicitação já foi avaliada.');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (input.decision === 'APPROVED') {
        if (req.kind === 'ADD') {
          await tx.timeEntry.create({
            data: {
              tenantId,
              employeeId: req.employeeId,
              type: req.proposedType!,
              occurredAt: req.proposedTime!,
              source: TimeEntrySource.MANUAL,
              correctionId: req.id,
              createdById: actorUserId,
            },
          });
        } else if (req.kind === 'EDIT' && req.targetEntryId) {
          await tx.timeEntry.update({
            where: { id: req.targetEntryId },
            data: {
              ...(req.proposedTime ? { occurredAt: req.proposedTime } : {}),
              ...(req.proposedType ? { type: req.proposedType } : {}),
              source: TimeEntrySource.MANUAL,
              correctionId: req.id,
            },
          });
        } else if (req.kind === 'REMOVE' && req.targetEntryId) {
          await tx.timeEntry.update({
            where: { id: req.targetEntryId },
            data: { deletedAt: new Date(), correctionId: req.id },
          });
        }
      }
      return tx.timeCorrectionRequest.update({
        where: { id: req.id },
        data: {
          status: input.decision,
          reviewedById: actorUserId,
          reviewedAt: new Date(),
          reviewNotes: input.reviewNotes ?? null,
        },
        include: { employee: { select: { id: true, fullName: true } } },
      });
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: `time_correction.${input.decision.toLowerCase()}`,
      resource: 'time_correction_requests',
      resourceId: id,
      afterState: { kind: req.kind, employeeId: req.employeeId },
    });

    return toCorrectionResponse(updated);
  }

  // ───────────────────────────────────────────────────────────────────────────
  private async assertEmployee(tenantId: string, id: string): Promise<void> {
    const e = await this.prisma.employee.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!e) throw new NotFoundException('Colaborador não encontrado');
  }

  private async tenantTimezone(tenantId: string): Promise<string> {
    const t = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { timezone: true },
    });
    return t?.timezone ?? 'America/Sao_Paulo';
  }
}

// ── helpers de cálculo ────────────────────────────────────────────────────────
/** YYYY-MM-DD do instante no timezone informado. */
function dayKey(instant: Date, tz: string): string {
  // en-CA dá formato YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/**
 * Minutos trabalhados a partir de pares CLOCK_IN→CLOCK_OUT, descontando
 * intervalos BREAK_START→BREAK_END. Marcações órfãs (IN sem OUT) são ignoradas.
 */
function computeWorkedMinutes(
  entries: { type: TimeEntryType; occurredAt: Date }[],
): number {
  const sorted = [...entries].sort(
    (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
  );
  let worked = 0;
  let inAt: Date | null = null;
  let breakAt: Date | null = null;
  for (const e of sorted) {
    if (e.type === 'CLOCK_IN') {
      inAt = e.occurredAt;
    } else if (e.type === 'CLOCK_OUT' && inAt) {
      worked += (e.occurredAt.getTime() - inAt.getTime()) / 60000;
      inAt = null;
    } else if (e.type === 'BREAK_START') {
      breakAt = e.occurredAt;
    } else if (e.type === 'BREAK_END' && breakAt) {
      worked -= (e.occurredAt.getTime() - breakAt.getTime()) / 60000;
      breakAt = null;
    }
  }
  return Math.max(0, Math.round(worked));
}

function toEntryResponse(e: {
  id: string;
  tenantId: string;
  employeeId: string;
  type: TimeEntryType;
  occurredAt: Date;
  source: TimeEntrySource;
  latitude: number | null;
  longitude: number | null;
  correctionId: string | null;
  notes: string | null;
  createdById: string | null;
  createdAt: Date;
  employee?: { id: string; fullName: string } | null;
}): TimeEntryResponse {
  return {
    id: e.id,
    tenantId: e.tenantId,
    employeeId: e.employeeId,
    type: e.type,
    occurredAt: e.occurredAt.toISOString(),
    source: e.source,
    latitude: e.latitude,
    longitude: e.longitude,
    correctionId: e.correctionId,
    notes: e.notes,
    createdById: e.createdById,
    createdAt: e.createdAt.toISOString(),
    employee: e.employee ?? null,
  };
}

function toCorrectionResponse(r: {
  id: string;
  tenantId: string;
  employeeId: string;
  kind: 'ADD' | 'EDIT' | 'REMOVE';
  targetDate: Date;
  targetEntryId: string | null;
  proposedType: TimeEntryType | null;
  proposedTime: Date | null;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  reviewedById: string | null;
  reviewedAt: Date | null;
  reviewNotes: string | null;
  createdAt: Date;
  updatedAt: Date;
  employee?: { id: string; fullName: string } | null;
}): TimeCorrectionResponse {
  return {
    id: r.id,
    tenantId: r.tenantId,
    employeeId: r.employeeId,
    kind: r.kind,
    targetDate: r.targetDate.toISOString().slice(0, 10),
    targetEntryId: r.targetEntryId,
    proposedType: r.proposedType,
    proposedTime: r.proposedTime ? r.proposedTime.toISOString() : null,
    reason: r.reason,
    status: r.status,
    reviewedById: r.reviewedById,
    reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString() : null,
    reviewNotes: r.reviewNotes,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    employee: r.employee ?? null,
  };
}
