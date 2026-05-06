import { Injectable } from '@nestjs/common';
import type { AuditLevel, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

export interface AuditLogInput {
  tenantId?: string | null;
  userId?: string | null;
  actor?: string | null;
  action: string;
  resource?: string;
  resourceId?: string;
  level?: AuditLevel;
  ip?: string;
  userAgent?: string;
  beforeState?: Prisma.InputJsonValue;
  afterState?: Prisma.InputJsonValue;
  metadata?: Prisma.InputJsonValue;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(input: AuditLogInput): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        tenantId: input.tenantId ?? null,
        userId: input.userId ?? null,
        actor: input.actor ?? null,
        action: input.action,
        resource: input.resource,
        resourceId: input.resourceId,
        level: input.level ?? 'INFO',
        ip: input.ip,
        userAgent: input.userAgent,
        beforeState: input.beforeState,
        afterState: input.afterState,
        metadata: input.metadata,
      },
    });
  }

  async list(params: {
    tenantId: string;
    page: number;
    pageSize: number;
    action?: string;
    userId?: string;
    resource?: string;
    resourceId?: string;
    level?: AuditLevel;
    dateFrom?: Date;
    dateTo?: Date;
    /**
     * Texto livre — busca em `action` e em `metadata` (JSON cast text).
     * Útil pra "encontrar logs do PPPoE 'joao.silva'" sem saber o resourceId.
     */
    search?: string;
  }) {
    const {
      tenantId,
      page,
      pageSize,
      action,
      userId,
      resource,
      resourceId,
      level,
      dateFrom,
      dateTo,
      search,
    } = params;

    const where: Prisma.AuditLogWhereInput = {
      tenantId,
      ...(action ? { action: { contains: action, mode: 'insensitive' as const } } : {}),
      ...(userId ? { userId } : {}),
      ...(resource ? { resource } : {}),
      ...(resourceId ? { resourceId } : {}),
      ...(level ? { level } : {}),
      ...(dateFrom || dateTo
        ? {
            createdAt: {
              ...(dateFrom ? { gte: dateFrom } : {}),
              ...(dateTo ? { lte: dateTo } : {}),
            },
          }
        : {}),
      ...(search
        ? {
            OR: [
              { action: { contains: search, mode: 'insensitive' as const } },
              { resourceId: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        // Inclui o ator pra renderizar nome/email no frontend sem N+1.
        include: {
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { data, total };
  }
}
