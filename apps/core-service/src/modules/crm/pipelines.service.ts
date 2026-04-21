import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import type {
  CreatePipelineRequest,
  CreateStageRequest,
  PipelineResponse,
  PipelineStageInput,
  PipelineStageResponse,
  UpdatePipelineRequest,
  UpdateStageRequest,
} from '@netx/shared';

import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

/**
 * Pipelines (funis comerciais) + estágios (colunas do Kanban).
 *
 * Regras:
 *  - Todo acesso é filtrado por tenantId.
 *  - Um tenant pode ter no máximo 1 pipeline com isDefault=true — o service
 *    garante a atomicidade trocando o default dentro de uma transaction.
 *  - Stages são sempre numerados com `order` 0-based, contíguo por pipeline.
 *  - Não é permitido deletar um stage que contenha deals abertos; o client
 *    precisa mover antes.
 */
@Injectable()
export class PipelinesService {
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
    input: CreatePipelineRequest,
  ): Promise<PipelineResponse> {
    const stages = input.stages?.length ? input.stages : defaultStages();

    try {
      const pipeline = await this.prisma.$transaction(async (tx) => {
        // Se vai ser default, remove default dos outros
        if (input.isDefault) {
          await tx.pipeline.updateMany({
            where: { tenantId, isDefault: true },
            data: { isDefault: false },
          });
        }

        const created = await tx.pipeline.create({
          data: {
            tenantId,
            name: input.name,
            slug: input.slug,
            description: input.description ?? null,
            color: input.color ?? null,
            isDefault: input.isDefault ?? false,
            stages: {
              create: stages.map((s, idx) => ({
                tenantId,
                name: s.name,
                order: idx,
                probability: s.probability ?? 0,
                color: s.color ?? null,
                isWon: s.isWon ?? false,
                isLost: s.isLost ?? false,
              })),
            },
          },
          include: { stages: { orderBy: { order: 'asc' } } },
        });
        return created;
      });

      await this.audit.log({
        tenantId,
        userId: actorUserId,
        action: 'crm.pipeline.created',
        resource: 'pipelines',
        resourceId: pipeline.id,
        afterState: { name: pipeline.name, slug: pipeline.slug },
      });
      return toPipelineResponse(pipeline);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException(`Pipeline com slug "${input.slug}" já existe`);
      }
      throw e;
    }
  }

  // ---------------------------------------------------------------------------
  // LIST
  // ---------------------------------------------------------------------------
  async list(tenantId: string, includeArchived = false): Promise<PipelineResponse[]> {
    const rows = await this.prisma.pipeline.findMany({
      where: { tenantId, ...(includeArchived ? {} : { isArchived: false }) },
      include: {
        stages: {
          orderBy: { order: 'asc' },
          include: { _count: { select: { deals: { where: { deletedAt: null } } } } },
        },
      },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
    return rows.map((p) =>
      toPipelineResponse(p, p.stages.map((s) => ({ ...s, dealCount: s._count.deals }))),
    );
  }

  // ---------------------------------------------------------------------------
  // FIND ONE
  // ---------------------------------------------------------------------------
  async findById(tenantId: string, id: string): Promise<PipelineResponse> {
    const row = await this.prisma.pipeline.findFirst({
      where: { id, tenantId },
      include: { stages: { orderBy: { order: 'asc' } } },
    });
    if (!row) throw new NotFoundException('Pipeline não encontrado');
    return toPipelineResponse(row);
  }

  async findDefault(tenantId: string): Promise<PipelineResponse | null> {
    const row = await this.prisma.pipeline.findFirst({
      where: { tenantId, isDefault: true, isArchived: false },
      include: { stages: { orderBy: { order: 'asc' } } },
    });
    return row ? toPipelineResponse(row) : null;
  }

  // ---------------------------------------------------------------------------
  // UPDATE
  // ---------------------------------------------------------------------------
  async update(
    tenantId: string,
    actorUserId: string,
    id: string,
    input: UpdatePipelineRequest,
  ): Promise<PipelineResponse> {
    const before = await this.prisma.pipeline.findFirst({ where: { id, tenantId } });
    if (!before) throw new NotFoundException('Pipeline não encontrado');

    const updated = await this.prisma.$transaction(async (tx) => {
      if (input.isDefault === true && !before.isDefault) {
        await tx.pipeline.updateMany({
          where: { tenantId, isDefault: true, NOT: { id } },
          data: { isDefault: false },
        });
      }
      return tx.pipeline.update({
        where: { id },
        data: {
          name: input.name,
          description: input.description,
          color: input.color,
          isDefault: input.isDefault,
          isArchived: input.isArchived,
        },
        include: { stages: { orderBy: { order: 'asc' } } },
      });
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'crm.pipeline.updated',
      resource: 'pipelines',
      resourceId: id,
      beforeState: { name: before.name, isDefault: before.isDefault },
      afterState: { name: updated.name, isDefault: updated.isDefault },
    });
    return toPipelineResponse(updated);
  }

  // ---------------------------------------------------------------------------
  // DELETE
  // ---------------------------------------------------------------------------
  async remove(tenantId: string, actorUserId: string, id: string): Promise<void> {
    const pipeline = await this.prisma.pipeline.findFirst({
      where: { id, tenantId },
      include: { _count: { select: { deals: { where: { deletedAt: null } } } } },
    });
    if (!pipeline) throw new NotFoundException('Pipeline não encontrado');
    if (pipeline._count.deals > 0) {
      throw new BadRequestException(
        'Pipeline possui deals ativos. Mova ou exclua os deals antes.',
      );
    }
    if (pipeline.isDefault) {
      throw new BadRequestException('Não é possível excluir o pipeline padrão.');
    }

    await this.prisma.pipeline.delete({ where: { id } });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'crm.pipeline.deleted',
      resource: 'pipelines',
      resourceId: id,
      beforeState: { name: pipeline.name },
    });
  }

  // ===========================================================================
  // STAGES
  // ===========================================================================

  async createStage(
    tenantId: string,
    actorUserId: string,
    pipelineId: string,
    input: CreateStageRequest,
  ): Promise<PipelineStageResponse> {
    await this.ensurePipelineExists(tenantId, pipelineId);

    const last = await this.prisma.pipelineStage.findFirst({
      where: { pipelineId },
      orderBy: { order: 'desc' },
      select: { order: true },
    });
    const nextOrder = (last?.order ?? -1) + 1;

    const stage = await this.prisma.pipelineStage.create({
      data: {
        tenantId,
        pipelineId,
        name: input.name,
        order: nextOrder,
        probability: input.probability ?? 0,
        color: input.color ?? null,
        isWon: input.isWon ?? false,
        isLost: input.isLost ?? false,
      },
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'crm.pipeline.stage.created',
      resource: 'pipeline_stages',
      resourceId: stage.id,
      afterState: { pipelineId, name: stage.name },
    });
    return toStageResponse(stage);
  }

  async updateStage(
    tenantId: string,
    actorUserId: string,
    pipelineId: string,
    stageId: string,
    input: UpdateStageRequest,
  ): Promise<PipelineStageResponse> {
    const before = await this.prisma.pipelineStage.findFirst({
      where: { id: stageId, pipelineId, tenantId },
    });
    if (!before) throw new NotFoundException('Estágio não encontrado');

    const updated = await this.prisma.pipelineStage.update({
      where: { id: stageId },
      data: {
        name: input.name,
        probability: input.probability,
        color: input.color,
        isWon: input.isWon,
        isLost: input.isLost,
      },
    });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'crm.pipeline.stage.updated',
      resource: 'pipeline_stages',
      resourceId: stageId,
      beforeState: { name: before.name },
      afterState: { name: updated.name },
    });
    return toStageResponse(updated);
  }

  async removeStage(
    tenantId: string,
    actorUserId: string,
    pipelineId: string,
    stageId: string,
  ): Promise<void> {
    const stage = await this.prisma.pipelineStage.findFirst({
      where: { id: stageId, pipelineId, tenantId },
      include: { _count: { select: { deals: { where: { deletedAt: null } } } } },
    });
    if (!stage) throw new NotFoundException('Estágio não encontrado');
    if (stage._count.deals > 0) {
      throw new BadRequestException(
        'Estágio possui deals. Mova os deals para outra coluna antes de excluir.',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.pipelineStage.delete({ where: { id: stageId } });

      // Reindexa estágios seguintes: como (pipelineId, order) é unique,
      // precisamos usar offset temporário. Fazemos em duas passadas:
      // 1) joga os `order` dos subsequentes para +1000000
      // 2) recompacta 0-based
      const remaining = await tx.pipelineStage.findMany({
        where: { pipelineId },
        orderBy: { order: 'asc' },
        select: { id: true, order: true },
      });
      for (const [i, s] of remaining.entries()) {
        if (s.order !== i) {
          await tx.pipelineStage.update({
            where: { id: s.id },
            data: { order: i + 1_000_000 },
          });
        }
      }
      const pass2 = await tx.pipelineStage.findMany({
        where: { pipelineId },
        orderBy: { order: 'asc' },
        select: { id: true },
      });
      for (const [i, s] of pass2.entries()) {
        await tx.pipelineStage.update({ where: { id: s.id }, data: { order: i } });
      }
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'crm.pipeline.stage.deleted',
      resource: 'pipeline_stages',
      resourceId: stageId,
      beforeState: { name: stage.name },
    });
  }

  async reorderStages(
    tenantId: string,
    actorUserId: string,
    pipelineId: string,
    stageIds: string[],
  ): Promise<PipelineStageResponse[]> {
    const current = await this.prisma.pipelineStage.findMany({
      where: { pipelineId, tenantId },
      select: { id: true },
    });
    if (current.length !== stageIds.length) {
      throw new BadRequestException('A lista deve conter todos os estágios do pipeline');
    }
    const currentSet = new Set(current.map((s) => s.id));
    for (const id of stageIds) {
      if (!currentSet.has(id)) {
        throw new BadRequestException(`Estágio ${id} não pertence a este pipeline`);
      }
    }

    // Two-pass reorder para não violar unique(pipelineId, order)
    const result = await this.prisma.$transaction(async (tx) => {
      for (const [i, id] of stageIds.entries()) {
        await tx.pipelineStage.update({
          where: { id },
          data: { order: i + 1_000_000 },
        });
      }
      for (const [i, id] of stageIds.entries()) {
        await tx.pipelineStage.update({ where: { id }, data: { order: i } });
      }
      return tx.pipelineStage.findMany({
        where: { pipelineId },
        orderBy: { order: 'asc' },
      });
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'crm.pipeline.stages.reordered',
      resource: 'pipelines',
      resourceId: pipelineId,
      afterState: { stageIds },
    });
    return result.map(toStageResponse);
  }

  // ---------------------------------------------------------------------------
  private async ensurePipelineExists(tenantId: string, pipelineId: string): Promise<void> {
    const ok = await this.prisma.pipeline.findFirst({
      where: { id: pipelineId, tenantId },
      select: { id: true },
    });
    if (!ok) throw new NotFoundException('Pipeline não encontrado');
  }
}

// =============================================================================
// Helpers de mapping
// =============================================================================
type StageRow = {
  id: string;
  pipelineId: string;
  name: string;
  order: number;
  probability: number;
  color: string | null;
  isWon: boolean;
  isLost: boolean;
  createdAt: Date;
  updatedAt: Date;
  dealCount?: number;
};

function toStageResponse(s: StageRow): PipelineStageResponse {
  return {
    id: s.id,
    pipelineId: s.pipelineId,
    name: s.name,
    order: s.order,
    probability: s.probability,
    color: s.color,
    isWon: s.isWon,
    isLost: s.isLost,
    dealCount: s.dealCount,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

function toPipelineResponse(
  p: {
    id: string;
    tenantId: string;
    name: string;
    slug: string;
    description: string | null;
    color: string | null;
    isDefault: boolean;
    isArchived: boolean;
    stages: StageRow[];
    createdAt: Date;
    updatedAt: Date;
  },
  stagesOverride?: StageRow[],
): PipelineResponse {
  const stages = (stagesOverride ?? p.stages).map(toStageResponse);
  return {
    id: p.id,
    tenantId: p.tenantId,
    name: p.name,
    slug: p.slug,
    description: p.description,
    color: p.color,
    isDefault: p.isDefault,
    isArchived: p.isArchived,
    stages,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

// =============================================================================
// Estágios padrão quando um pipeline é criado sem definir estágios.
// =============================================================================
export function defaultStages(): PipelineStageInput[] {
  return [
    { name: 'Novo lead', probability: 10, color: '#64748b' },
    { name: 'Qualificado', probability: 25, color: '#0ea5e9' },
    { name: 'Proposta enviada', probability: 50, color: '#a855f7' },
    { name: 'Negociação', probability: 75, color: '#f59e0b' },
    { name: 'Ganho', probability: 100, color: '#22c55e', isWon: true },
    { name: 'Perdido', probability: 0, color: '#ef4444', isLost: true },
  ];
}
