import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DealLostReason as PrismaDealLostReason, Prisma } from '@prisma/client';

import {
  paginationMeta,
  type CreateDealRequest,
  type DealBoardColumn,
  type DealBoardResponse,
  type DealHistoryEntry,
  type DealLostReason,
  type DealResponse,
  type GetDealsBoardQuery,
  type ListDealsQuery,
  type LoseDealRequest,
  type MoveDealStageRequest,
  type Paginated,
  type ReopenDealRequest,
  type ReorderDealsRequest,
  type UpdateDealRequest,
  type WinDealRequest,
} from '@netx/shared';

import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

/**
 * Deals (oportunidades) — orquestração do Kanban comercial.
 *
 * Regras centrais:
 *  - Multi-tenant: tudo filtrado por tenantId.
 *  - Soft-delete via `deletedAt`; deals excluídos nunca voltam em listas.
 *  - `position` mantém a ordem dentro da coluna (stage). Ao mover um deal:
 *      - recalcula position do destino
 *      - grava DealHistory com {fromStage, toStage, fromStatus, toStatus}
 *  - Status é derivado do stage alvo quando possível (stage.isWon/isLost),
 *    mas rotas explícitas (/win /lose /reopen) são preferidas para carregar
 *    motivo/nota.
 */
@Injectable()
export class DealsService {
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
    input: CreateDealRequest,
  ): Promise<DealResponse> {
    const pipeline = await this.prisma.pipeline.findFirst({
      where: { id: input.pipelineId, tenantId },
      include: { stages: { orderBy: { order: 'asc' } } },
    });
    if (!pipeline) throw new NotFoundException('Pipeline não encontrado');
    if (pipeline.isArchived) {
      throw new BadRequestException('Pipeline está arquivado');
    }

    let stage = input.stageId
      ? pipeline.stages.find((s) => s.id === input.stageId)
      : pipeline.stages.find((s) => !s.isWon && !s.isLost) ?? pipeline.stages[0];
    if (!stage) {
      throw new BadRequestException('Pipeline sem estágios configurados');
    }
    if (input.stageId && !pipeline.stages.find((s) => s.id === input.stageId)) {
      throw new BadRequestException('Estágio não pertence ao pipeline informado');
    }

    // Nova posição = max + 1 dentro da coluna
    const last = await this.prisma.deal.findFirst({
      where: { tenantId, stageId: stage.id, deletedAt: null },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    const position = (last?.position ?? -1) + 1;

    const status = stage.isWon ? 'WON' : stage.isLost ? 'LOST' : 'OPEN';

    const created = await this.prisma.$transaction(async (tx) => {
      const deal = await tx.deal.create({
        data: {
          tenantId,
          pipelineId: pipeline.id,
          stageId: stage.id,
          title: input.title,
          description: input.description ?? null,
          value: input.value !== undefined ? new Prisma.Decimal(input.value) : new Prisma.Decimal(0),
          currency: (input.currency ?? 'BRL').toUpperCase(),
          probability: input.probability ?? null,
          expectedCloseAt: input.expectedCloseAt ? new Date(input.expectedCloseAt) : null,
          status,
          position,
          customerId: input.customerId ?? null,
          ownerId: input.ownerId ?? actorUserId,
          createdById: actorUserId,
          updatedById: actorUserId,
          closedAt: status !== 'OPEN' ? new Date() : null,
        },
        include: defaultInclude(),
      });
      await tx.dealHistory.create({
        data: {
          tenantId,
          dealId: deal.id,
          fromStageId: null,
          toStageId: deal.stageId,
          fromStatus: null,
          toStatus: deal.status,
          changedById: actorUserId,
        },
      });
      return deal;
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'crm.deal.created',
      resource: 'deals',
      resourceId: created.id,
      afterState: { title: created.title, stageId: created.stageId, value: created.value.toString() },
    });
    return toDealResponse(created);
  }

  // ---------------------------------------------------------------------------
  // LIST (flat paginated — para relatórios/filtros, não o Kanban)
  // ---------------------------------------------------------------------------
  async list(tenantId: string, q: ListDealsQuery): Promise<Paginated<DealResponse>> {
    const where: Prisma.DealWhereInput = {
      tenantId,
      deletedAt: null,
      ...(q.pipelineId ? { pipelineId: q.pipelineId } : {}),
      ...(q.stageId ? { stageId: q.stageId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.ownerId ? { ownerId: q.ownerId } : {}),
      ...(q.customerId ? { customerId: q.customerId } : {}),
      ...(q.search
        ? {
            OR: [
              { title: { contains: q.search, mode: 'insensitive' } },
              { description: { contains: q.search, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(q.expectedCloseFrom || q.expectedCloseTo
        ? {
            expectedCloseAt: {
              ...(q.expectedCloseFrom ? { gte: new Date(q.expectedCloseFrom) } : {}),
              ...(q.expectedCloseTo ? { lte: new Date(q.expectedCloseTo) } : {}),
            },
          }
        : {}),
      ...(q.minValue !== undefined || q.maxValue !== undefined
        ? {
            value: {
              ...(q.minValue !== undefined ? { gte: new Prisma.Decimal(q.minValue) } : {}),
              ...(q.maxValue !== undefined ? { lte: new Prisma.Decimal(q.maxValue) } : {}),
            },
          }
        : {}),
    };

    const orderBy: Prisma.DealOrderByWithRelationInput = { [q.sortBy]: q.sortDir };

    const [rows, total] = await Promise.all([
      this.prisma.deal.findMany({
        where,
        include: defaultInclude(),
        orderBy,
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.deal.count({ where }),
    ]);

    return {
      data: rows.map(toDealResponse),
      pagination: paginationMeta(total, q.page, q.pageSize),
    };
  }

  // ---------------------------------------------------------------------------
  // BOARD (Kanban — agrupado por stage)
  // ---------------------------------------------------------------------------
  async board(tenantId: string, q: GetDealsBoardQuery): Promise<DealBoardResponse> {
    const pipeline = await this.prisma.pipeline.findFirst({
      where: { id: q.pipelineId, tenantId },
      include: { stages: { orderBy: { order: 'asc' } } },
    });
    if (!pipeline) throw new NotFoundException('Pipeline não encontrado');

    const baseWhere: Prisma.DealWhereInput = {
      tenantId,
      pipelineId: pipeline.id,
      deletedAt: null,
      ...(q.ownerId ? { ownerId: q.ownerId } : {}),
      ...(q.search
        ? {
            OR: [
              { title: { contains: q.search, mode: 'insensitive' } },
              { description: { contains: q.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const columns: DealBoardColumn[] = [];
    for (const stage of pipeline.stages) {
      const where = { ...baseWhere, stageId: stage.id };
      const [deals, totalCount, agg] = await Promise.all([
        this.prisma.deal.findMany({
          where,
          include: defaultInclude(),
          orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
          take: q.perStageLimit,
        }),
        this.prisma.deal.count({ where }),
        this.prisma.deal.aggregate({ where, _sum: { value: true } }),
      ]);
      columns.push({
        stage: {
          id: stage.id,
          name: stage.name,
          order: stage.order,
          probability: stage.probability,
          color: stage.color,
          isWon: stage.isWon,
          isLost: stage.isLost,
        },
        deals: deals.map(toDealResponse),
        totalCount,
        totalValue: agg._sum.value ? Number(agg._sum.value) : 0,
        hasMore: totalCount > deals.length,
      });
    }

    return { pipelineId: pipeline.id, columns };
  }

  // ---------------------------------------------------------------------------
  // FIND ONE
  // ---------------------------------------------------------------------------
  async findById(tenantId: string, id: string): Promise<DealResponse> {
    const row = await this.prisma.deal.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: defaultInclude(),
    });
    if (!row) throw new NotFoundException('Deal não encontrado');
    return toDealResponse(row);
  }

  // ---------------------------------------------------------------------------
  // UPDATE (campos básicos — NÃO muda stageId aqui, use /move)
  // ---------------------------------------------------------------------------
  async update(
    tenantId: string,
    actorUserId: string,
    id: string,
    input: UpdateDealRequest,
  ): Promise<DealResponse> {
    const before = await this.prisma.deal.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!before) throw new NotFoundException('Deal não encontrado');

    const updated = await this.prisma.deal.update({
      where: { id },
      data: {
        title: input.title,
        description: input.description,
        value: input.value !== undefined ? new Prisma.Decimal(input.value) : undefined,
        currency: input.currency ? input.currency.toUpperCase() : undefined,
        probability: input.probability,
        expectedCloseAt:
          input.expectedCloseAt === undefined
            ? undefined
            : input.expectedCloseAt === null
              ? null
              : new Date(input.expectedCloseAt),
        customerId: input.customerId,
        ownerId: input.ownerId,
        updatedById: actorUserId,
      },
      include: defaultInclude(),
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'crm.deal.updated',
      resource: 'deals',
      resourceId: id,
      beforeState: { title: before.title, value: before.value.toString() },
      afterState: { title: updated.title, value: updated.value.toString() },
    });
    return toDealResponse(updated);
  }

  // ---------------------------------------------------------------------------
  // MOVE (drag-drop entre colunas ou reorder vertical)
  // ---------------------------------------------------------------------------
  async move(
    tenantId: string,
    actorUserId: string,
    id: string,
    input: MoveDealStageRequest,
  ): Promise<DealResponse> {
    const deal = await this.prisma.deal.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: { pipeline: { include: { stages: true } } },
    });
    if (!deal) throw new NotFoundException('Deal não encontrado');

    const targetStage = deal.pipeline.stages.find((s) => s.id === input.stageId);
    if (!targetStage) {
      throw new BadRequestException('Estágio alvo não pertence ao pipeline do deal');
    }

    const targetStatus = targetStage.isWon ? 'WON' : targetStage.isLost ? 'LOST' : 'OPEN';
    const statusChanged = targetStatus !== deal.status;
    const stageChanged = targetStage.id !== deal.stageId;

    const updated = await this.prisma.$transaction(async (tx) => {
      // Reabre "espaço" na coluna destino na posição informada.
      let newPosition = input.position ?? 0;
      if (stageChanged) {
        // deals existentes na coluna destino: deslocar os que ficam >= newPosition
        await tx.deal.updateMany({
          where: {
            tenantId,
            stageId: targetStage.id,
            deletedAt: null,
            position: { gte: newPosition },
          },
          data: { position: { increment: 1 } },
        });
      } else {
        // reorder dentro da mesma coluna — tratar via ReorderDealsRequest de
        // preferência; aqui aceitamos movimento vertical simples.
        const currentPos = deal.position;
        if (newPosition === currentPos) {
          // nada a fazer
        } else if (newPosition < currentPos) {
          await tx.deal.updateMany({
            where: {
              tenantId,
              stageId: deal.stageId,
              deletedAt: null,
              position: { gte: newPosition, lt: currentPos },
              NOT: { id: deal.id },
            },
            data: { position: { increment: 1 } },
          });
        } else {
          await tx.deal.updateMany({
            where: {
              tenantId,
              stageId: deal.stageId,
              deletedAt: null,
              position: { gt: currentPos, lte: newPosition },
              NOT: { id: deal.id },
            },
            data: { position: { decrement: 1 } },
          });
        }
      }

      const d = await tx.deal.update({
        where: { id },
        data: {
          stageId: targetStage.id,
          status: targetStatus,
          position: newPosition,
          closedAt:
            targetStatus !== 'OPEN'
              ? deal.closedAt ?? new Date()
              : deal.status !== 'OPEN'
                ? null
                : undefined,
          updatedById: actorUserId,
          // Se voltou a OPEN, limpa motivo/nota de perdido
          ...(deal.status === 'LOST' && targetStatus === 'OPEN'
            ? { lostReason: null, lostNote: null }
            : {}),
        },
        include: defaultInclude(),
      });

      if (stageChanged || statusChanged) {
        await tx.dealHistory.create({
          data: {
            tenantId,
            dealId: id,
            fromStageId: deal.stageId,
            toStageId: targetStage.id,
            fromStatus: deal.status,
            toStatus: targetStatus,
            changedById: actorUserId,
            reason: input.reason ?? null,
          },
        });
      }
      return d;
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'crm.deal.moved',
      resource: 'deals',
      resourceId: id,
      beforeState: { stageId: deal.stageId, position: deal.position, status: deal.status },
      afterState: { stageId: targetStage.id, position: updated.position, status: updated.status },
    });
    return toDealResponse(updated);
  }

  // ---------------------------------------------------------------------------
  // REORDER (múltiplos deals de uma coluna em uma chamada)
  // ---------------------------------------------------------------------------
  async reorder(
    tenantId: string,
    actorUserId: string,
    input: ReorderDealsRequest,
  ): Promise<void> {
    // valida que todos pertencem à coluna
    const existing = await this.prisma.deal.findMany({
      where: { id: { in: input.dealIds }, tenantId, deletedAt: null, stageId: input.stageId },
      select: { id: true },
    });
    if (existing.length !== input.dealIds.length) {
      throw new BadRequestException('Alguns deals não pertencem a esta coluna');
    }

    await this.prisma.$transaction(async (tx) => {
      for (const [i, dealId] of input.dealIds.entries()) {
        await tx.deal.update({
          where: { id: dealId },
          data: { position: i + 1_000_000, updatedById: actorUserId },
        });
      }
      for (const [i, dealId] of input.dealIds.entries()) {
        await tx.deal.update({ where: { id: dealId }, data: { position: i } });
      }
    });
  }

  // ---------------------------------------------------------------------------
  // WIN / LOSE / REOPEN
  // ---------------------------------------------------------------------------
  async win(
    tenantId: string,
    actorUserId: string,
    id: string,
    input: WinDealRequest,
  ): Promise<DealResponse> {
    return this.closeDeal(tenantId, actorUserId, id, {
      targetStatus: 'WON',
      targetStageId: input.stageId,
      note: input.note,
    });
  }

  async lose(
    tenantId: string,
    actorUserId: string,
    id: string,
    input: LoseDealRequest,
  ): Promise<DealResponse> {
    return this.closeDeal(tenantId, actorUserId, id, {
      targetStatus: 'LOST',
      targetStageId: input.stageId,
      lostReason: input.reason,
      note: input.note,
    });
  }

  async reopen(
    tenantId: string,
    actorUserId: string,
    id: string,
    input: ReopenDealRequest,
  ): Promise<DealResponse> {
    const deal = await this.prisma.deal.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: { pipeline: { include: { stages: true } } },
    });
    if (!deal) throw new NotFoundException('Deal não encontrado');
    if (deal.status === 'OPEN') {
      throw new ConflictException('Deal já está aberto');
    }
    const target = deal.pipeline.stages.find((s) => s.id === input.stageId);
    if (!target) throw new BadRequestException('Estágio alvo inválido');
    if (target.isWon || target.isLost) {
      throw new BadRequestException('Estágio de reabertura deve ser OPEN (não pode ser Ganho/Perdido)');
    }
    return this.move(tenantId, actorUserId, id, { stageId: target.id, position: 0 });
  }

  private async closeDeal(
    tenantId: string,
    actorUserId: string,
    id: string,
    opts: {
      targetStatus: 'WON' | 'LOST';
      targetStageId?: string;
      lostReason?: DealLostReason;
      note?: string;
    },
  ): Promise<DealResponse> {
    const deal = await this.prisma.deal.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: { pipeline: { include: { stages: true } } },
    });
    if (!deal) throw new NotFoundException('Deal não encontrado');

    const stage = opts.targetStageId
      ? deal.pipeline.stages.find((s) => s.id === opts.targetStageId)
      : deal.pipeline.stages.find(
          (s) => (opts.targetStatus === 'WON' ? s.isWon : s.isLost) === true,
        );
    if (!stage) {
      throw new BadRequestException(
        `Pipeline não possui um estágio ${opts.targetStatus === 'WON' ? 'de ganho' : 'de perda'}. Informe stageId.`,
      );
    }
    if (opts.targetStatus === 'WON' && !stage.isWon) {
      throw new BadRequestException('stageId informado não é um estágio de ganho');
    }
    if (opts.targetStatus === 'LOST' && !stage.isLost) {
      throw new BadRequestException('stageId informado não é um estágio de perda');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const d = await tx.deal.update({
        where: { id },
        data: {
          stageId: stage.id,
          status: opts.targetStatus,
          lostReason:
            opts.targetStatus === 'LOST'
              ? opts.lostReason
                ? (opts.lostReason as PrismaDealLostReason)
                : null
              : null,
          lostNote: opts.targetStatus === 'LOST' ? opts.note ?? null : null,
          closedAt: new Date(),
          updatedById: actorUserId,
        },
        include: defaultInclude(),
      });
      await tx.dealHistory.create({
        data: {
          tenantId,
          dealId: id,
          fromStageId: deal.stageId,
          toStageId: stage.id,
          fromStatus: deal.status,
          toStatus: opts.targetStatus,
          changedById: actorUserId,
          reason: opts.note ?? opts.lostReason ?? null,
        },
      });
      return d;
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: opts.targetStatus === 'WON' ? 'crm.deal.won' : 'crm.deal.lost',
      resource: 'deals',
      resourceId: id,
      afterState: { stageId: stage.id, status: opts.targetStatus },
    });
    return toDealResponse(updated);
  }

  // ---------------------------------------------------------------------------
  // HISTORY
  // ---------------------------------------------------------------------------
  async history(tenantId: string, id: string): Promise<DealHistoryEntry[]> {
    const exists = await this.prisma.deal.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('Deal não encontrado');

    const rows = await this.prisma.dealHistory.findMany({
      where: { tenantId, dealId: id },
      orderBy: { createdAt: 'asc' },
      include: { changedBy: { select: { id: true, name: true } } },
    });
    return rows.map((h) => ({
      id: h.id,
      dealId: h.dealId,
      fromStageId: h.fromStageId,
      toStageId: h.toStageId,
      fromStatus: h.fromStatus,
      toStatus: h.toStatus,
      changedById: h.changedById,
      changedByName: h.changedBy?.name ?? null,
      reason: h.reason,
      createdAt: h.createdAt.toISOString(),
    }));
  }

  // ---------------------------------------------------------------------------
  // SOFT DELETE
  // ---------------------------------------------------------------------------
  async remove(tenantId: string, actorUserId: string, id: string): Promise<void> {
    const before = await this.prisma.deal.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!before) throw new NotFoundException('Deal não encontrado');

    await this.prisma.deal.update({
      where: { id },
      data: { deletedAt: new Date(), updatedById: actorUserId },
    });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'crm.deal.deleted',
      resource: 'deals',
      resourceId: id,
      beforeState: { title: before.title },
    });
  }
}

// =============================================================================
// Helpers
// =============================================================================
function defaultInclude() {
  return {
    customer: {
      select: {
        id: true,
        displayName: true,
        primaryEmail: true,
        primaryPhone: true,
      },
    },
    owner: { select: { id: true, name: true, email: true } },
    stage: {
      select: { id: true, name: true, color: true, isWon: true, isLost: true },
    },
    _count: { select: { activities: { where: { deletedAt: null } } } },
  } satisfies Prisma.DealInclude;
}

type DealRow = Prisma.DealGetPayload<{ include: ReturnType<typeof defaultInclude> }>;

function toDealResponse(d: DealRow): DealResponse {
  return {
    id: d.id,
    tenantId: d.tenantId,
    pipelineId: d.pipelineId,
    stageId: d.stageId,
    title: d.title,
    description: d.description,
    value: Number(d.value),
    currency: d.currency,
    probability: d.probability,
    expectedCloseAt: d.expectedCloseAt ? d.expectedCloseAt.toISOString().slice(0, 10) : null,
    status: d.status,
    lostReason: d.lostReason,
    lostNote: d.lostNote,
    position: d.position,
    customerId: d.customerId,
    ownerId: d.ownerId,
    closedAt: d.closedAt ? d.closedAt.toISOString() : null,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
    deletedAt: d.deletedAt ? d.deletedAt.toISOString() : null,
    customer: d.customer
      ? {
          id: d.customer.id,
          displayName: d.customer.displayName,
          primaryEmail: d.customer.primaryEmail,
          primaryPhone: d.customer.primaryPhone,
        }
      : null,
    owner: d.owner
      ? { id: d.owner.id, name: d.owner.name, email: d.owner.email }
      : null,
    stage: d.stage
      ? {
          id: d.stage.id,
          name: d.stage.name,
          color: d.stage.color,
          isWon: d.stage.isWon,
          isLost: d.stage.isLost,
        }
      : undefined,
    activityCount: d._count.activities,
  };
}
