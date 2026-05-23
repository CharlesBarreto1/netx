/**
 * PlansService — CRUD do catálogo de planos de internet.
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Um plano define velocidade (download/upload) + preço. O contrato referencia
 * o plano e denormaliza os valores — desativar/editar um plano não afeta
 * contratos já firmados.
 *
 * @provenance Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=
 */
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  type CreatePlanRequest,
  type ListPlansQuery,
  type PlanResponse,
  type UpdatePlanRequest,
} from '@netx/shared';
import { Prisma } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

type PlanRow = Prisma.PlanGetPayload<{ include: { _count: { select: { contracts: true } } } }>;

function toResponse(p: PlanRow): PlanResponse {
  return {
    id: p.id,
    tenantId: p.tenantId,
    name: p.name,
    description: p.description,
    downloadMbps: p.downloadMbps,
    uploadMbps: p.uploadMbps,
    monthlyPrice: p.monthlyPrice.toString(),
    blockAfterDays: p.blockAfterDays,
    isActive: p.isActive,
    order: p.order,
    contractCount: p._count.contracts,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

@Injectable()
export class PlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(tenantId: string, q: ListPlansQuery): Promise<PlanResponse[]> {
    const rows = await this.prisma.plan.findMany({
      where: {
        tenantId,
        deletedAt: null,
        ...(q.includeInactive ? {} : { isActive: true }),
      },
      include: { _count: { select: { contracts: true } } },
      orderBy: [{ order: 'asc' }, { name: 'asc' }],
    });
    return rows.map(toResponse);
  }

  async findById(tenantId: string, id: string): Promise<PlanResponse> {
    const row = await this.prisma.plan.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: { _count: { select: { contracts: true } } },
    });
    if (!row) throw new NotFoundException('Plano não encontrado');
    return toResponse(row);
  }

  async create(
    tenantId: string,
    actorUserId: string,
    input: CreatePlanRequest,
  ): Promise<PlanResponse> {
    try {
      const created = await this.prisma.plan.create({
        data: {
          tenantId,
          name: input.name,
          description: input.description ?? null,
          downloadMbps: input.downloadMbps,
          uploadMbps: input.uploadMbps,
          monthlyPrice: new Prisma.Decimal(input.monthlyPrice),
          blockAfterDays: input.blockAfterDays,
          isActive: input.isActive,
          order: input.order,
        },
        include: { _count: { select: { contracts: true } } },
      });
      await this.audit.log({
        tenantId,
        userId: actorUserId,
        action: 'plans.created',
        resource: 'plans',
        resourceId: created.id,
      });
      return toResponse(created);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Já existe um plano com esse nome');
      }
      throw err;
    }
  }

  async update(
    tenantId: string,
    actorUserId: string,
    id: string,
    input: UpdatePlanRequest,
  ): Promise<PlanResponse> {
    const existing = await this.prisma.plan.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Plano não encontrado');

    const data: Prisma.PlanUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description ?? null;
    if (input.downloadMbps !== undefined) data.downloadMbps = input.downloadMbps;
    if (input.uploadMbps !== undefined) data.uploadMbps = input.uploadMbps;
    if (input.monthlyPrice !== undefined)
      data.monthlyPrice = new Prisma.Decimal(input.monthlyPrice);
    if (input.blockAfterDays !== undefined) data.blockAfterDays = input.blockAfterDays;
    if (input.isActive !== undefined) data.isActive = input.isActive;
    if (input.order !== undefined) data.order = input.order;

    try {
      const updated = await this.prisma.plan.update({
        where: { id },
        data,
        include: { _count: { select: { contracts: true } } },
      });
      await this.audit.log({
        tenantId,
        userId: actorUserId,
        action: 'plans.updated',
        resource: 'plans',
        resourceId: id,
      });
      return toResponse(updated);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Já existe um plano com esse nome');
      }
      throw err;
    }
  }

  async remove(tenantId: string, actorUserId: string, id: string): Promise<void> {
    const existing = await this.prisma.plan.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: { _count: { select: { contracts: true } } },
    });
    if (!existing) throw new NotFoundException('Plano não encontrado');
    if (existing._count.contracts > 0) {
      // Não deleta plano em uso — desativa. O FK é SET NULL, mas perder a
      // referência de N contratos silenciosamente é ruim. Forçamos desativar.
      throw new ConflictException(
        `Plano em uso por ${existing._count.contracts} contrato(s) — ` +
          'desative em vez de excluir (mantém a referência histórica).',
      );
    }
    await this.prisma.plan.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'plans.deleted',
      resource: 'plans',
      resourceId: id,
    });
  }
}
