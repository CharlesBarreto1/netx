import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { Prisma, UserStatus } from '@prisma/client';

import { hashPassword } from '@netx/auth';
import { loadConfig } from '@netx/config';
import type {
  CreateUserRequest,
  UpdateMyUserRequest,
  UpdateUserRequest,
  UserResponse,
  Paginated,
} from '@netx/shared';
import { paginationMeta } from '@netx/shared';
import { randomBytes } from 'crypto';

import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class UsersService {
  private readonly argon2Config = loadConfig().argon2;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(tenantId: string, actorUserId: string, input: CreateUserRequest): Promise<UserResponse> {
    const existing = await this.prisma.user.findUnique({
      where: { tenantId_email: { tenantId, email: input.email } },
    });
    if (existing) throw new ConflictException('User with this email already exists');

    // 3 caminhos de senha:
    //   1) input.password informado → usa; user nasce ACTIVE.
    //   2) sem password e sendInvite=true → gera tempPass; user fica INVITED
    //      (até o módulo Notifications mandar email convite, o admin precisa
    //      acionar reset manual).
    //   3) sem password e sendInvite=false → gera tempPass; ACTIVE (admin
    //      provavelmente vai resetar via UI).
    const initialPassword =
      input.password ?? randomBytes(16).toString('base64url');
    const passwordHash = await hashPassword(initialPassword, this.argon2Config);
    const initialStatus = input.password
      ? UserStatus.ACTIVE
      : input.sendInvite
        ? UserStatus.INVITED
        : UserStatus.ACTIVE;

    const user = await this.prisma.user.create({
      data: {
        tenantId,
        email: input.email,
        firstName: input.firstName,
        lastName: input.lastName,
        phone: input.phone,
        locale: input.locale,
        timezone: input.timezone,
        passwordHash,
        status: initialStatus,
        invitedById: actorUserId,
        // Prisma exige Prisma.JsonNull (sentinel) pra setar JSON nulo no DB.
        // Passar literal `null` quebra o tipo. Comportamento: undefined/null
        // do input → coluna fica NULL (sem override de menus).
        menuAccess: input.menuAccess ?? Prisma.JsonNull,
        userRoles: {
          create: input.roleIds.map((roleId) => ({ roleId })),
        },
      },
      include: { userRoles: { include: { role: true } } },
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'user.created',
      resource: 'users',
      resourceId: user.id,
      // Audit registra QUE senha foi setada, nunca o valor.
      afterState: {
        email: user.email,
        roles: input.roleIds,
        passwordSet: !!input.password,
        status: user.status,
      },
    });

    // TODO: enqueue invite email via RabbitMQ (Notifications module)
    return this.toResponse(user);
  }

  async list(
    tenantId: string,
    page: number,
    pageSize: number,
    search?: string,
  ): Promise<Paginated<UserResponse>> {
    const where = {
      tenantId,
      deletedAt: null,
      ...(search
        ? {
            OR: [
              { email: { contains: search, mode: 'insensitive' as const } },
              { firstName: { contains: search, mode: 'insensitive' as const } },
              { lastName: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        include: { userRoles: { include: { role: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);
    return {
      data: rows.map((r) => this.toResponse(r)),
      pagination: paginationMeta(total, page, pageSize),
    };
  }

  async findById(tenantId: string, id: string): Promise<UserResponse> {
    const user = await this.prisma.user.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: { userRoles: { include: { role: true } } },
    });
    if (!user) throw new NotFoundException('User not found');
    return this.toResponse(user);
  }

  async update(
    tenantId: string,
    actorUserId: string,
    id: string,
    input: UpdateUserRequest,
  ): Promise<UserResponse> {
    const before = await this.prisma.user.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!before) throw new NotFoundException('User not found');

    // Reset de senha pelo admin: se input.password vier, hashea agora e
    // atualiza passwordHash junto. Bons padrões cuidados aqui:
    //   - exige min 8 chars (já validado no Zod)
    //   - audit registra que senha foi resetada, sem o valor
    //   - se a UI tiver políticas (ex.: forçar troca no próximo login), basta
    //     mexer em `status` aqui também (nada de schema novo).
    const passwordHash = input.password
      ? await hashPassword(input.password, this.argon2Config)
      : undefined;

    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        firstName: input.firstName,
        lastName: input.lastName,
        phone: input.phone,
        locale: input.locale,
        timezone: input.timezone,
        status: input.status,
        ...(passwordHash ? { passwordHash } : {}),
        // Mesma regra do create: Prisma.JsonNull pro caso "limpar override".
        // input.menuAccess === undefined → não toca no campo.
        // input.menuAccess === null → limpa override (NULL no DB).
        // input.menuAccess === array → grava o array.
        ...(input.menuAccess !== undefined
          ? { menuAccess: input.menuAccess === null ? Prisma.JsonNull : input.menuAccess }
          : {}),
        ...(input.roleIds
          ? {
              userRoles: {
                deleteMany: {},
                create: input.roleIds.map((roleId) => ({ roleId })),
              },
            }
          : {}),
      },
      include: { userRoles: { include: { role: true } } },
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: input.password ? 'user.password_reset' : 'user.updated',
      resource: 'users',
      resourceId: id,
      beforeState: { status: before.status },
      afterState: {
        status: updated.status,
        ...(input.password ? { passwordReset: true } : {}),
      },
    });

    return this.toResponse(updated);
  }

  /**
   * Atualiza o próprio user (escopo /me): mais restritivo que `update`.
   * Não mexe em status, roles, email ou MFA. Principal uso hoje é o switcher
   * de idioma (locale).
   */
  async updateMe(userId: string, input: UpdateMyUserRequest): Promise<UserResponse> {
    const before = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
    });
    if (!before) throw new NotFoundException('User not found');

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        firstName: input.firstName,
        lastName: input.lastName,
        phone: input.phone,
        locale: input.locale,
        timezone: input.timezone,
      },
      include: { userRoles: { include: { role: true } } },
    });

    await this.audit.log({
      tenantId: before.tenantId,
      userId,
      action: 'user.self_updated',
      resource: 'users',
      resourceId: userId,
      afterState: { locale: updated.locale, timezone: updated.timezone },
    });

    return this.toResponse(updated);
  }

  async softDelete(tenantId: string, actorUserId: string, id: string): Promise<void> {
    const user = await this.prisma.user.findFirst({ where: { id, tenantId, deletedAt: null } });
    if (!user) throw new NotFoundException('User not found');

    await this.prisma.user.update({
      where: { id },
      data: { deletedAt: new Date(), status: UserStatus.DISABLED },
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'user.deleted',
      resource: 'users',
      resourceId: id,
    });
  }

  private toResponse(u: any): UserResponse {
    return {
      id: u.id,
      tenantId: u.tenantId,
      email: u.email,
      emailVerified: u.emailVerified,
      firstName: u.firstName,
      lastName: u.lastName,
      phone: u.phone,
      locale: u.locale,
      timezone: u.timezone,
      status: u.status,
      mfaEnabled: u.mfaEnabled,
      roles: u.userRoles?.map((ur: any) => ({ id: ur.role.id, name: ur.role.name })) ?? [],
      // menuAccess vem do Postgres como Json (any). Normalizamos pra string[]|null.
      menuAccess: Array.isArray(u.menuAccess)
        ? (u.menuAccess as unknown[]).filter((x): x is string => typeof x === 'string')
        : null,
      lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
      createdAt: u.createdAt.toISOString(),
      updatedAt: u.updatedAt.toISOString(),
    };
  }
}
