import { Injectable, NotFoundException } from '@nestjs/common';
import { TimeEntrySource, TimeEntryType } from '@prisma/client';
import {
  type ClockInOut,
  type CreateTimeCorrection,
  type DocumentSignatureResponse,
  type EmployeeDocumentResponse,
  type SelfClockStatusResponse,
  type SelfDashboardResponse,
  type SelfDocumentsResponse,
  type SelfEarningsResponse,
  type SelfProfileResponse,
  type TimeCorrectionResponse,
  type TimeEntryResponse,
  type TimesheetResponse,
} from '@netx/shared';

import { PrismaService } from '../prisma/prisma.service';
import { CompanyPostsService } from './company-posts.service';
import { EmployeeDocumentsService } from './employee-documents.service';
import { PayrollService } from './payroll.service';
import { TimeclockService } from './timeclock.service';

/**
 * Self-service do colaborador. Tudo aqui resolve o Employee a partir do User
 * logado (currentUser.id). Não exige permissão hr.* — só ter Employee vinculado.
 */
@Injectable()
export class HrSelfService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly timeclock: TimeclockService,
    private readonly docs: EmployeeDocumentsService,
    private readonly payroll: PayrollService,
    private readonly posts: CompanyPostsService,
  ) {}

  /** Resolve o colaborador do usuário logado (404 se não houver vínculo). */
  async resolveEmployeeId(tenantId: string, userId: string): Promise<string> {
    const e = await this.prisma.employee.findFirst({
      where: { tenantId, userId, deletedAt: null },
      select: { id: true },
    });
    if (!e) {
      throw new NotFoundException(
        'Seu usuário não está vinculado a um colaborador.',
      );
    }
    return e.id;
  }

  async profile(tenantId: string, userId: string): Promise<SelfProfileResponse> {
    const e = await this.prisma.employee.findFirst({
      where: { tenantId, userId, deletedAt: null },
    });
    if (!e) throw new NotFoundException('Colaborador não encontrado');
    return {
      employeeId: e.id,
      fullName: e.fullName,
      preferredName: e.preferredName,
      department: e.department,
      position: e.position,
      registration: e.registration,
      hiredAt: e.hiredAt ? e.hiredAt.toISOString().slice(0, 10) : null,
      workSchedule: e.workSchedule,
      email: e.email,
      phone: e.phone,
    };
  }

  async clockStatus(
    tenantId: string,
    userId: string,
  ): Promise<SelfClockStatusResponse> {
    const employeeId = await this.resolveEmployeeId(tenantId, userId);
    return this.computeClockStatus(tenantId, employeeId);
  }

  async clock(
    tenantId: string,
    userId: string,
    body: ClockInOut,
    ip?: string | null,
  ): Promise<TimeEntryResponse> {
    const employeeId = await this.resolveEmployeeId(tenantId, userId);
    return this.timeclock.clock(tenantId, employeeId, body, {
      source: TimeEntrySource.PORTAL,
      ipAddress: ip,
      actorUserId: userId,
    });
  }

  async timesheet(
    tenantId: string,
    userId: string,
    from: string,
    to: string,
  ): Promise<TimesheetResponse> {
    const employeeId = await this.resolveEmployeeId(tenantId, userId);
    return this.timeclock.timesheet(tenantId, employeeId, from, to);
  }

  async createCorrection(
    tenantId: string,
    userId: string,
    input: CreateTimeCorrection,
  ): Promise<TimeCorrectionResponse> {
    const employeeId = await this.resolveEmployeeId(tenantId, userId);
    return this.timeclock.createCorrection(tenantId, employeeId, input);
  }

  async earnings(tenantId: string, userId: string): Promise<SelfEarningsResponse> {
    const employeeId = await this.resolveEmployeeId(tenantId, userId);
    const { data } = await this.payroll.list(tenantId, {
      employeeId,
      page: 1,
      pageSize: 24,
    });
    // Colaborador só vê holerites aprovados/pagos (não rascunhos do RH).
    const payslips = data.filter(
      (p) => p.status === 'APPROVED' || p.status === 'PAID',
    );
    return { payslips };
  }

  async documents(
    tenantId: string,
    userId: string,
  ): Promise<SelfDocumentsResponse> {
    const employeeId = await this.resolveEmployeeId(tenantId, userId);
    const all = await this.docs.list(tenantId, employeeId, {});
    return {
      pendingSignature: all.filter(
        (d) => d.requiresSignature && !d.signature,
      ),
      signed: all.filter((d) => d.requiresSignature && !!d.signature),
    };
  }

  async documentDownloadUrl(
    tenantId: string,
    userId: string,
    docId: string,
  ): Promise<{ url: string; expiresIn: number }> {
    const employeeId = await this.resolveEmployeeId(tenantId, userId);
    return this.docs.getDownloadUrl(tenantId, employeeId, docId);
  }

  async signDocument(
    tenantId: string,
    userId: string,
    docId: string,
    ctx: { ip?: string | null; userAgent?: string | null },
  ): Promise<DocumentSignatureResponse> {
    const employeeId = await this.resolveEmployeeId(tenantId, userId);
    return this.docs.sign(tenantId, employeeId, docId, {
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
      actorUserId: userId,
    });
  }

  async feed(tenantId: string) {
    return this.posts.listPublished(tenantId, 20);
  }

  async dashboard(
    tenantId: string,
    userId: string,
  ): Promise<SelfDashboardResponse> {
    const profile = await this.profile(tenantId, userId);
    const clock = await this.computeClockStatus(tenantId, profile.employeeId);
    const pendingSignatures = await this.prisma.employeeDocument.count({
      where: {
        tenantId,
        employeeId: profile.employeeId,
        deletedAt: null,
        requiresSignature: true,
        signature: { is: null },
      },
    });
    const latestPosts = await this.posts.listPublished(tenantId, 5);
    return { profile, clock, pendingSignatures, latestPosts };
  }

  // ───────────────────────────────────────────────────────────────────────────
  private async computeClockStatus(
    tenantId: string,
    employeeId: string,
  ): Promise<SelfClockStatusResponse> {
    const t = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { timezone: true },
    });
    const tz = t?.timezone ?? 'America/Sao_Paulo';
    const todayKey = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());

    // Janela folgada (2 dias) pra cobrir fuso; filtra pelo dia local depois.
    const since = new Date(Date.now() - 36 * 60 * 60 * 1000);
    const entries = await this.prisma.timeEntry.findMany({
      where: {
        tenantId,
        employeeId,
        deletedAt: null,
        occurredAt: { gte: since },
      },
      orderBy: { occurredAt: 'asc' },
    });

    const dayFmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const today = entries.filter((e) => dayFmt.format(e.occurredAt) === todayKey);

    const last = today[today.length - 1] ?? null;
    const nextAction: TimeEntryType =
      !last || last.type === 'CLOCK_OUT'
        ? TimeEntryType.CLOCK_IN
        : last.type === 'CLOCK_IN'
          ? TimeEntryType.CLOCK_OUT
          : last.type === 'BREAK_START'
            ? TimeEntryType.BREAK_END
            : TimeEntryType.CLOCK_OUT;

    return {
      nextAction,
      lastEntry: last
        ? { type: last.type, occurredAt: last.occurredAt.toISOString() }
        : null,
      todayWorkedMinutes: computeWorked(today),
      todayEntries: today.map((e) => ({
        type: e.type,
        occurredAt: e.occurredAt.toISOString(),
      })),
    };
  }
}

function computeWorked(
  entries: { type: TimeEntryType; occurredAt: Date }[],
): number {
  let worked = 0;
  let inAt: Date | null = null;
  let breakAt: Date | null = null;
  for (const e of entries) {
    if (e.type === 'CLOCK_IN') inAt = e.occurredAt;
    else if (e.type === 'CLOCK_OUT' && inAt) {
      worked += (e.occurredAt.getTime() - inAt.getTime()) / 60000;
      inAt = null;
    } else if (e.type === 'BREAK_START') breakAt = e.occurredAt;
    else if (e.type === 'BREAK_END' && breakAt) {
      worked -= (e.occurredAt.getTime() - breakAt.getTime()) / 60000;
      breakAt = null;
    }
  }
  return Math.max(0, Math.round(worked));
}
