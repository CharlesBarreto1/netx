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

  async list(params: { tenantId: string; page: number; pageSize: number; action?: string }) {
    const { tenantId, page, pageSize, action } = params;
    const where = { tenantId, ...(action ? { action } : {}) };

    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { data, total };
  }
}
