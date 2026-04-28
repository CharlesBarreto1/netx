import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { UserStatus } from '@prisma/client';

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

    // If not sending an invite, generate a random initial password. The user
    // should change it on first login. In production, prefer invite links.
    const tempPassword = randomBytes(16).toString('base64url');
    const passwordHash = await hashPassword(tempPassword, this.argon2Config);

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
        status: input.sendInvite ? UserStatus.INVITED : UserStatus.ACTIVE,
        invitedById: actorUserId,
        // null = sem override; array = lista permitida
        menuAccess: input.menuAccess ?? null,
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
      afterState: { email: user.email, roles: input.roleIds },
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

    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        firstName: input.firstName,
        lastName: input.lastName,
        phone: input.phone,
        locale: input.locale,
        timezone: input.timezone,
        status: input.status,
        // input.menuAccess === null limpa override (sem restrição extra);
        // === undefined deixa como está; array sobrescreve.
        ...(input.menuAccess !== undefined ? { menuAccess: input.menuAccess } : {}),
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
      action: 'user.updated',
      resource: 'users',
      resourceId: id,
      beforeState: { status: before.status },
      afterState: { status: updated.status },
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
