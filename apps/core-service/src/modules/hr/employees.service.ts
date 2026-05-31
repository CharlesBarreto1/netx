import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EmployeeStatus, EmploymentType, PayFrequency, Prisma, UserStatus } from '@prisma/client';
import { hashPassword } from '@netx/auth';
import { loadConfig } from '@netx/config';
import { randomBytes } from 'crypto';
import {
  paginationMeta,
  type CreateEmployeeRequest,
  type CreateEmployeeResponse,
  type EmployeeResponse,
  type ListEmployeesQuery,
  type Paginated,
  type UpdateEmployeeRequest,
} from '@netx/shared';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

// Menus do portal self-service liberados pro User provisionado de colaborador.
// Whitelist em User.menuAccess — ver apps/web/src/lib/menus.ts.
const EMPLOYEE_MENU_ACCESS = [
  'meHome',
  'meTimeclock',
  'meEarnings',
  'meDocuments',
  'meNews',
  'security', // troca de senha / 2FA do próprio usuário
];

const employeeInclude = {
  manager: { select: { id: true, fullName: true } },
  user: { select: { id: true, email: true, status: true } },
  _count: { select: { reports: true } },
} satisfies Prisma.EmployeeInclude;

type EmployeeRow = Prisma.EmployeeGetPayload<{ include: typeof employeeInclude }>;

@Injectable()
export class EmployeesService {
  private readonly argon2 = loadConfig().argon2;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    tenantId: string,
    q: ListEmployeesQuery,
  ): Promise<Paginated<EmployeeResponse>> {
    const where: Prisma.EmployeeWhereInput = {
      tenantId,
      deletedAt: null,
      ...(q.status ? { status: q.status as EmployeeStatus } : {}),
      ...(q.department ? { department: q.department } : {}),
      ...(q.managerId ? { managerId: q.managerId } : {}),
      ...(q.search
        ? {
            OR: [
              { fullName: { contains: q.search, mode: 'insensitive' } },
              { preferredName: { contains: q.search, mode: 'insensitive' } },
              { document: { contains: q.search, mode: 'insensitive' } },
              { registration: { contains: q.search, mode: 'insensitive' } },
              { position: { contains: q.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.employee.findMany({
        where,
        include: employeeInclude,
        orderBy: { [q.sortBy]: q.sortDir },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.employee.count({ where }),
    ]);

    return {
      data: rows.map(toEmployeeResponse),
      pagination: paginationMeta(total, q.page, q.pageSize),
    };
  }

  async findById(tenantId: string, id: string): Promise<EmployeeResponse> {
    const e = await this.prisma.employee.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: employeeInclude,
    });
    if (!e) throw new NotFoundException('Colaborador não encontrado');
    return toEmployeeResponse(e);
  }

  async create(
    tenantId: string,
    actorUserId: string,
    input: CreateEmployeeRequest,
  ): Promise<CreateEmployeeResponse> {
    if (input.userId && input.provisionUser) {
      throw new BadRequestException(
        'Informe userId OU provisionUser, não os dois.',
      );
    }
    if (input.managerId) await this.assertEmployee(tenantId, input.managerId);
    if (input.userId) await this.assertUserFree(tenantId, input.userId);

    let provisioned: CreateEmployeeResponse['provisionedUser'] = null;
    let linkedUserId = input.userId ?? null;

    if (input.provisionUser) {
      if (!input.email) {
        throw new BadRequestException(
          'provisionUser exige email para o login do colaborador.',
        );
      }
      const { userId, initialPassword } = await this.provisionLoginUser(
        tenantId,
        actorUserId,
        input,
      );
      linkedUserId = userId;
      provisioned = { id: userId, email: input.email, initialPassword };
    }

    const registration = await this.nextRegistration(tenantId);

    const e = await this.prisma.employee.create({
      data: {
        tenantId,
        registration,
        ...this.mapWritable(input),
        userId: linkedUserId,
        createdById: actorUserId,
      } as Prisma.EmployeeUncheckedCreateInput,
      include: employeeInclude,
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'employee.created',
      resource: 'employees',
      resourceId: e.id,
      afterState: { fullName: e.fullName, provisionedUser: !!provisioned },
    });

    return { ...toEmployeeResponse(e), provisionedUser: provisioned };
  }

  async update(
    tenantId: string,
    actorUserId: string,
    id: string,
    input: UpdateEmployeeRequest,
  ): Promise<EmployeeResponse> {
    const before = await this.prisma.employee.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!before) throw new NotFoundException('Colaborador não encontrado');

    if (input.managerId) {
      if (input.managerId === id) {
        throw new BadRequestException('Colaborador não pode ser o próprio gestor.');
      }
      await this.assertEmployee(tenantId, input.managerId);
    }
    if (input.userId) await this.assertUserFree(tenantId, input.userId, id);

    const e = await this.prisma.employee.update({
      where: { id },
      data: {
        ...this.mapWritable(input),
        ...(input.userId !== undefined ? { userId: input.userId } : {}),
        ...(input.terminatedAt !== undefined
          ? { terminatedAt: input.terminatedAt ? new Date(input.terminatedAt) : null }
          : {}),
        ...(input.terminationReason !== undefined
          ? { terminationReason: input.terminationReason }
          : {}),
        updatedById: actorUserId,
      } as Prisma.EmployeeUncheckedUpdateInput,
      include: employeeInclude,
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'employee.updated',
      resource: 'employees',
      resourceId: id,
      beforeState: { fullName: before.fullName, status: before.status },
      afterState: { fullName: e.fullName, status: e.status },
    });

    return toEmployeeResponse(e);
  }

  async remove(tenantId: string, actorUserId: string, id: string): Promise<void> {
    const before = await this.prisma.employee.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!before) throw new NotFoundException('Colaborador não encontrado');

    await this.prisma.$transaction([
      // Desvincula subordinados antes do soft-delete (evita gestor órfão).
      this.prisma.employee.updateMany({
        where: { tenantId, managerId: id },
        data: { managerId: null },
      }),
      this.prisma.employee.update({
        where: { id },
        data: { deletedAt: new Date(), status: EmployeeStatus.TERMINATED },
      }),
    ]);

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'employee.deleted',
      resource: 'employees',
      resourceId: id,
      beforeState: { fullName: before.fullName },
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Helpers
  // ───────────────────────────────────────────────────────────────────────────

  /** Campos comuns create/update (exceto vínculos e flags de provisão). */
  private mapWritable(input: Partial<CreateEmployeeRequest>): Record<string, unknown> {
    const set: Record<string, unknown> = {};
    const s = (k: keyof CreateEmployeeRequest, v: unknown) => {
      if (input[k] !== undefined) set[k as string] = v;
    };
    s('fullName', input.fullName);
    s('preferredName', input.preferredName ?? null);
    s('document', input.document ?? null);
    s('documentType', input.documentType ?? null);
    s('socialSecurityNo', input.socialSecurityNo ?? null);
    if (input.birthDate !== undefined)
      set.birthDate = input.birthDate ? new Date(input.birthDate) : null;
    s('gender', input.gender ?? null);
    s('maritalStatus', input.maritalStatus ?? null);
    s('nationality', input.nationality ?? null);
    s('email', input.email ?? null);
    s('phone', input.phone ?? null);
    s('emergencyContact', input.emergencyContact ?? null);
    s('emergencyPhone', input.emergencyPhone ?? null);
    s('address', input.address ?? null);
    s('department', input.department ?? null);
    s('position', input.position ?? null);
    if (input.employmentType !== undefined)
      set.employmentType = input.employmentType as EmploymentType;
    if (input.status !== undefined) set.status = input.status as EmployeeStatus;
    if (input.hiredAt !== undefined)
      set.hiredAt = input.hiredAt ? new Date(input.hiredAt) : null;
    if (input.probationEndsAt !== undefined)
      set.probationEndsAt = input.probationEndsAt
        ? new Date(input.probationEndsAt)
        : null;
    if (input.baseSalary !== undefined)
      set.baseSalary = input.baseSalary ?? null;
    if (input.payFrequency !== undefined)
      set.payFrequency = input.payFrequency as PayFrequency;
    if (input.weeklyHours !== undefined)
      set.weeklyHours = input.weeklyHours ?? null;
    s('workSchedule', input.workSchedule ?? null);
    if (input.clockToleranceMin !== undefined)
      set.clockToleranceMin = input.clockToleranceMin;
    if (input.skills !== undefined) set.skills = input.skills;
    s('notes', input.notes ?? null);
    if (input.managerId !== undefined) set.managerId = input.managerId ?? null;
    return set;
  }

  /** Matrícula sequencial EMP-0001 por tenant. Idempotente o suficiente. */
  private async nextRegistration(tenantId: string): Promise<string> {
    const count = await this.prisma.employee.count({ where: { tenantId } });
    return `EMP-${String(count + 1).padStart(4, '0')}`;
  }

  private async provisionLoginUser(
    tenantId: string,
    actorUserId: string,
    input: CreateEmployeeRequest,
  ): Promise<{ userId: string; initialPassword: string }> {
    const email = input.email!;
    const existing = await this.prisma.user.findUnique({
      where: { tenantId_email: { tenantId, email } },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('Já existe um usuário com este email.');
    }

    const role = await this.prisma.role.findFirst({
      where: {
        name: 'employee',
        OR: [{ tenantId }, { tenantId: null }],
      },
      select: { id: true },
      orderBy: { tenantId: 'desc' }, // prefere role do tenant sobre global
    });
    if (!role) {
      throw new BadRequestException(
        'Role "employee" não encontrada — rode o seed (npm run db:seed).',
      );
    }

    const initialPassword = generateTempPassword();
    const passwordHash = await hashPassword(initialPassword, this.argon2);

    const [first, ...rest] = input.fullName.trim().split(/\s+/);

    const user = await this.prisma.user.create({
      data: {
        tenantId,
        email,
        firstName: first ?? input.fullName,
        lastName: rest.join(' ') || '-',
        passwordHash,
        status: UserStatus.ACTIVE,
        mustChangePassword: true,
        invitedById: actorUserId,
        menuAccess: EMPLOYEE_MENU_ACCESS,
        userRoles: { create: [{ roleId: role.id }] },
      },
      select: { id: true },
    });

    return { userId: user.id, initialPassword };
  }

  private async assertEmployee(tenantId: string, id: string): Promise<void> {
    const e = await this.prisma.employee.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!e) throw new NotFoundException('Gestor (colaborador) não encontrado');
  }

  /** Garante que o User existe no tenant e não está vinculado a outro colaborador. */
  private async assertUserFree(
    tenantId: string,
    userId: string,
    selfEmployeeId?: string,
  ): Promise<void> {
    const u = await this.prisma.user.findFirst({
      where: { id: userId, tenantId, deletedAt: null },
      select: { id: true, employeeProfile: { select: { id: true } } },
    });
    if (!u) throw new NotFoundException('Usuário vinculado não encontrado');
    if (u.employeeProfile && u.employeeProfile.id !== selfEmployeeId) {
      throw new ConflictException(
        'Este usuário já está vinculado a outro colaborador.',
      );
    }
  }
}

// Senha temporária legível (sem ambíguos). Trocada no 1º login (mustChangePassword).
function generateTempPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(12);
  let out = '';
  for (let i = 0; i < 12; i++) out += chars[bytes[i] % chars.length];
  return out;
}

function toEmployeeResponse(e: EmployeeRow): EmployeeResponse {
  const d = (v: Date | null) => (v ? v.toISOString().slice(0, 10) : null);
  return {
    id: e.id,
    tenantId: e.tenantId,
    registration: e.registration,
    fullName: e.fullName,
    preferredName: e.preferredName,
    document: e.document,
    documentType: e.documentType,
    socialSecurityNo: e.socialSecurityNo,
    birthDate: d(e.birthDate),
    gender: e.gender,
    maritalStatus: e.maritalStatus,
    nationality: e.nationality,
    email: e.email,
    phone: e.phone,
    emergencyContact: e.emergencyContact,
    emergencyPhone: e.emergencyPhone,
    address: e.address,
    department: e.department,
    position: e.position,
    employmentType: e.employmentType,
    status: e.status,
    hiredAt: d(e.hiredAt),
    probationEndsAt: d(e.probationEndsAt),
    terminatedAt: d(e.terminatedAt),
    terminationReason: e.terminationReason,
    baseSalary: e.baseSalary ? Number(e.baseSalary) : null,
    payFrequency: e.payFrequency,
    weeklyHours: e.weeklyHours ? Number(e.weeklyHours) : null,
    workSchedule: e.workSchedule,
    clockToleranceMin: e.clockToleranceMin,
    skills: e.skills,
    notes: e.notes,
    userId: e.userId,
    managerId: e.managerId,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
    manager: e.manager ? { id: e.manager.id, fullName: e.manager.fullName } : null,
    user: e.user
      ? { id: e.user.id, email: e.user.email, status: e.user.status }
      : null,
    reportsCount: e._count.reports,
  };
}
