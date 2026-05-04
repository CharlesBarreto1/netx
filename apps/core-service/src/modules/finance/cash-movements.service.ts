import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  CashMovementType as PrismaMovementType,
  CashMovementSource as PrismaMovementSource,
} from '@prisma/client';
import { randomUUID } from 'crypto';

import {
  paginationMeta,
  type CashMovementResponse,
  type CashMovementSource,
  type CashMovementType,
  type CashRegisterBalanceResponse,
  type CreateMovementRequest,
  type CreateTransferRequest,
  type ListMovementsQuery,
  type Paginated,
} from '@netx/shared';

import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CashRegistersService } from './cash-registers.service';

/**
 * CashMovement — extrato dos caixas.
 *
 * Sinais por type pra calcular saldo:
 *   INCOME, TRANSFER_IN, ADJUSTMENT  → +amount
 *   OUTCOME, TRANSFER_OUT             → -amount
 *
 * Transferência sempre cria 2 rows numa transação atomica, com mesmo
 * transferGroupId. Se algo falhar (caixa origem sem saldo, destino inativo)
 * a transação é revertida — nunca fica meia transferência.
 */
@Injectable()
export class CashMovementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly registers: CashRegistersService,
  ) {}

  // ---------------------------------------------------------------------------
  // RECORD INCOME (interno — chamado por pay() de fatura/cobrança)
  // ---------------------------------------------------------------------------
  async recordIncome(opts: {
    tenantId: string;
    cashRegisterId: string;
    amount: number;
    source: CashMovementSource;
    sourceId: string;
    description?: string;
    actorUserId: string;
    occurredAt?: Date;
  }): Promise<void> {
    if (opts.amount <= 0) return;
    await this.prisma.cashMovement.create({
      data: {
        tenantId: opts.tenantId,
        cashRegisterId: opts.cashRegisterId,
        type: PrismaMovementType.INCOME,
        source: opts.source as PrismaMovementSource,
        sourceId: opts.sourceId,
        amount: new Prisma.Decimal(opts.amount),
        description: opts.description ?? null,
        occurredAt: opts.occurredAt ?? new Date(),
        createdById: opts.actorUserId,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // CREATE MANUAL (sangria, ajuste)
  // ---------------------------------------------------------------------------
  async createManual(
    tenantId: string,
    actorUserId: string,
    isManager: boolean,
    cashRegisterId: string,
    input: CreateMovementRequest,
  ): Promise<CashMovementResponse> {
    await this.registers.assertOperator(
      tenantId,
      cashRegisterId,
      actorUserId,
      isManager,
    );
    const m = await this.prisma.cashMovement.create({
      data: {
        tenantId,
        cashRegisterId,
        type: input.type as PrismaMovementType,
        source: PrismaMovementSource.MANUAL,
        amount: new Prisma.Decimal(input.amount),
        description: input.description ?? null,
        occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
        createdById: actorUserId,
      },
    });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'cash_movement.manual',
      resource: 'cash_movements',
      resourceId: m.id,
      afterState: { type: input.type, amount: input.amount },
    });
    return toResponse(m);
  }

  // ---------------------------------------------------------------------------
  // TRANSFER (atomic — 2 movements com mesmo transferGroupId)
  // ---------------------------------------------------------------------------
  async transfer(
    tenantId: string,
    actorUserId: string,
    isManager: boolean,
    fromCashRegisterId: string,
    input: CreateTransferRequest,
  ): Promise<{ outId: string; inId: string; transferGroupId: string }> {
    if (fromCashRegisterId === input.toCashRegisterId) {
      throw new BadRequestException(
        'Caixa de origem e destino não podem ser o mesmo',
      );
    }
    if (input.amount <= 0) {
      throw new BadRequestException('Valor deve ser positivo');
    }

    // O user precisa operar AMBOS os caixas (origem pra debitar, destino
    // pra creditar). Admin com cash_registers.manage bypassa.
    await this.registers.assertOperator(
      tenantId,
      fromCashRegisterId,
      actorUserId,
      isManager,
    );
    await this.registers.assertOperator(
      tenantId,
      input.toCashRegisterId,
      actorUserId,
      isManager,
    );

    const transferGroupId = randomUUID();
    const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
    const description = input.description ?? null;

    const result = await this.prisma.$transaction(async (tx) => {
      const out = await tx.cashMovement.create({
        data: {
          tenantId,
          cashRegisterId: fromCashRegisterId,
          type: PrismaMovementType.TRANSFER_OUT,
          source: PrismaMovementSource.TRANSFER,
          amount: new Prisma.Decimal(input.amount),
          description,
          occurredAt,
          transferGroupId,
          createdById: actorUserId,
        },
      });
      const incoming = await tx.cashMovement.create({
        data: {
          tenantId,
          cashRegisterId: input.toCashRegisterId,
          type: PrismaMovementType.TRANSFER_IN,
          source: PrismaMovementSource.TRANSFER,
          amount: new Prisma.Decimal(input.amount),
          description,
          occurredAt,
          transferGroupId,
          createdById: actorUserId,
        },
      });
      return { outId: out.id, inId: incoming.id };
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'cash_movement.transfer',
      resource: 'cash_movements',
      resourceId: transferGroupId,
      afterState: {
        from: fromCashRegisterId,
        to: input.toCashRegisterId,
        amount: input.amount,
      },
    });
    return { ...result, transferGroupId };
  }

  // ---------------------------------------------------------------------------
  // LIST
  // ---------------------------------------------------------------------------
  async list(
    tenantId: string,
    actorUserId: string,
    isManager: boolean,
    cashRegisterId: string,
    q: ListMovementsQuery,
  ): Promise<Paginated<CashMovementResponse>> {
    // Verifica visibilidade do caixa (membership ou admin).
    const cr = await this.prisma.cashRegister.findFirst({
      where: { id: cashRegisterId, tenantId, deletedAt: null },
      include: {
        memberships: { where: { userId: actorUserId } },
      },
    });
    if (!cr) throw new NotFoundException('Caixa não encontrado');
    if (!isManager && cr.memberships.length === 0) {
      throw new ForbiddenException('Sem acesso a este caixa');
    }

    const where: Prisma.CashMovementWhereInput = {
      tenantId,
      cashRegisterId,
      ...(q.type ? { type: q.type as PrismaMovementType } : {}),
      ...(q.source ? { source: q.source as PrismaMovementSource } : {}),
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
      this.prisma.cashMovement.findMany({
        where,
        orderBy: { occurredAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.cashMovement.count({ where }),
    ]);

    // Pra cada TRANSFER, busca o "outro lado" pra mostrar destino/origem na UI.
    const groupIds = rows
      .filter((r) => r.transferGroupId)
      .map((r) => r.transferGroupId!) as string[];
    const peers =
      groupIds.length > 0
        ? await this.prisma.cashMovement.findMany({
            where: {
              transferGroupId: { in: groupIds },
              cashRegisterId: { not: cashRegisterId },
            },
            include: { cashRegister: { select: { id: true, name: true } } },
          })
        : [];

    const peerByGroup = new Map(peers.map((p) => [p.transferGroupId!, p]));

    return {
      data: rows.map((r) => {
        const peer = r.transferGroupId
          ? peerByGroup.get(r.transferGroupId)
          : undefined;
        return toResponse(
          r,
          peer
            ? {
                cashRegisterId: peer.cashRegisterId,
                cashRegisterName: (peer as any).cashRegister.name,
              }
            : null,
        );
      }),
      pagination: paginationMeta(total, q.page, q.pageSize),
    };
  }

  // ---------------------------------------------------------------------------
  // BALANCE
  // ---------------------------------------------------------------------------
  async balance(
    tenantId: string,
    actorUserId: string,
    isManager: boolean,
    cashRegisterId: string,
  ): Promise<CashRegisterBalanceResponse> {
    const cr = await this.prisma.cashRegister.findFirst({
      where: { id: cashRegisterId, tenantId, deletedAt: null },
      include: {
        memberships: { where: { userId: actorUserId } },
      },
    });
    if (!cr) throw new NotFoundException('Caixa não encontrado');
    if (!isManager && cr.memberships.length === 0) {
      throw new ForbiddenException('Sem acesso a este caixa');
    }

    // Agrega por tipo numa única query.
    const grouped = await this.prisma.cashMovement.groupBy({
      by: ['type'],
      where: { tenantId, cashRegisterId },
      _sum: { amount: true },
    });

    const byType = {
      income: 0,
      outcome: 0,
      transferIn: 0,
      transferOut: 0,
      adjustment: 0,
    };
    for (const g of grouped) {
      const v = Number(g._sum.amount ?? 0);
      switch (g.type) {
        case 'INCOME':
          byType.income = v;
          break;
        case 'OUTCOME':
          byType.outcome = v;
          break;
        case 'TRANSFER_IN':
          byType.transferIn = v;
          break;
        case 'TRANSFER_OUT':
          byType.transferOut = v;
          break;
        case 'ADJUSTMENT':
          byType.adjustment = v;
          break;
      }
    }
    const movementsTotal =
      byType.income +
      byType.transferIn +
      byType.adjustment -
      byType.outcome -
      byType.transferOut;
    const opening = Number(cr.openingBalance);

    return {
      cashRegisterId,
      openingBalance: opening,
      movementsTotal,
      currentBalance: opening + movementsTotal,
      byType,
    };
  }
}

// =============================================================================
// MAPPER
// =============================================================================
function toResponse(
  m: any,
  counterpart?: { cashRegisterId: string; cashRegisterName: string } | null,
): CashMovementResponse {
  return {
    id: m.id,
    tenantId: m.tenantId,
    cashRegisterId: m.cashRegisterId,
    type: m.type as CashMovementType,
    source: m.source as CashMovementSource,
    amount: Number(m.amount),
    description: m.description,
    occurredAt: m.occurredAt.toISOString(),
    sourceId: m.sourceId,
    transferGroupId: m.transferGroupId,
    createdById: m.createdById,
    createdAt: m.createdAt.toISOString(),
    counterpart: counterpart ?? null,
  };
}
