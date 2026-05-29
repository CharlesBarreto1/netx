import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FleetExpenseType, Prisma } from '@prisma/client';

import {
  paginationMeta,
  type CreateFleetExpenseRequest,
  type FleetExpenseResponse,
  type ListFleetExpensesQuery,
  type Paginated,
  type UpdateFleetExpenseRequest,
} from '@netx/shared';

import { AuditService } from '../audit/audit.service';
import { CashMovementsService } from '../finance/cash-movements.service';
import { PrismaService } from '../prisma/prisma.service';

const expenseInclude = {
  vehicle: { select: { id: true, plate: true } },
  driver: { select: { id: true, name: true } },
  cashRegister: { select: { id: true, name: true } },
} satisfies Prisma.FleetExpenseInclude;

type ExpenseWithRelations = Prisma.FleetExpenseGetPayload<{
  include: typeof expenseInclude;
}>;

@Injectable()
export class FleetExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly cashMovements: CashMovementsService,
  ) {}

  async list(
    tenantId: string,
    q: ListFleetExpensesQuery,
  ): Promise<Paginated<FleetExpenseResponse>> {
    const where: Prisma.FleetExpenseWhereInput = {
      tenantId,
      deletedAt: null,
      ...(q.vehicleId ? { vehicleId: q.vehicleId } : {}),
      ...(q.driverId ? { driverId: q.driverId } : {}),
      ...(q.type ? { type: q.type as FleetExpenseType } : {}),
      ...(q.cashRegisterId ? { cashRegisterId: q.cashRegisterId } : {}),
      ...(q.search ? { description: { contains: q.search, mode: 'insensitive' } } : {}),
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
      this.prisma.fleetExpense.findMany({
        where,
        include: expenseInclude,
        orderBy: { [q.sortBy]: q.sortDir },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.fleetExpense.count({ where }),
    ]);

    return {
      data: rows.map(toExpenseResponse),
      pagination: paginationMeta(total, q.page, q.pageSize),
    };
  }

  async findById(tenantId: string, id: string): Promise<FleetExpenseResponse> {
    const e = await this.prisma.fleetExpense.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: expenseInclude,
    });
    if (!e) throw new NotFoundException('Despesa não encontrada');
    return toExpenseResponse(e);
  }

  async create(
    tenantId: string,
    actorUserId: string,
    input: CreateFleetExpenseRequest,
  ): Promise<FleetExpenseResponse> {
    await this.assertVehicle(tenantId, input.vehicleId);
    if (input.driverId) await this.assertDriver(tenantId, input.driverId);
    if (input.cashRegisterId) await this.assertCashRegister(tenantId, input.cashRegisterId);

    const id = await this.prisma.$transaction(async (tx) => {
      const created = await tx.fleetExpense.create({
        data: {
          tenantId,
          vehicleId: input.vehicleId,
          driverId: input.driverId ?? null,
          type: input.type as FleetExpenseType,
          amount: new Prisma.Decimal(input.amount),
          occurredAt: new Date(input.occurredAt),
          odometer: input.odometer ?? null,
          description: input.description ?? null,
          cashRegisterId: input.cashRegisterId ?? null,
          createdById: actorUserId,
        },
      });

      if (input.cashRegisterId) {
        const movementId = await this.cashMovements.recordExpense({
          tenantId,
          cashRegisterId: input.cashRegisterId,
          amount: input.amount,
          sourceId: created.id,
          description: input.description ?? `Despesa de frota (${input.type})`,
          actorUserId,
          occurredAt: new Date(input.occurredAt),
          tx,
        });
        await tx.fleetExpense.update({
          where: { id: created.id },
          data: { cashMovementId: movementId },
        });
      }

      return created.id;
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'fleet_expense.created',
      resource: 'fleet_expenses',
      resourceId: id,
      afterState: {
        vehicleId: input.vehicleId,
        type: input.type,
        amount: input.amount,
        cashRegisterId: input.cashRegisterId ?? null,
      },
    });

    return this.findById(tenantId, id);
  }

  async update(
    tenantId: string,
    actorUserId: string,
    id: string,
    input: UpdateFleetExpenseRequest,
  ): Promise<FleetExpenseResponse> {
    const before = await this.prisma.fleetExpense.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!before) throw new NotFoundException('Despesa não encontrada');

    if (input.vehicleId) await this.assertVehicle(tenantId, input.vehicleId);
    if (input.driverId) await this.assertDriver(tenantId, input.driverId);
    if (input.cashRegisterId) await this.assertCashRegister(tenantId, input.cashRegisterId);

    // Estado final dos campos que afetam o movimento financeiro.
    const finalRegister =
      input.cashRegisterId !== undefined ? input.cashRegisterId : before.cashRegisterId;
    const finalAmount = input.amount !== undefined ? input.amount : Number(before.amount);
    const finalOccurredAt = input.occurredAt ? new Date(input.occurredAt) : before.occurredAt;
    const finalDescription =
      input.description !== undefined ? input.description : before.description;

    await this.prisma.$transaction(async (tx) => {
      await tx.fleetExpense.update({
        where: { id },
        data: {
          ...(input.vehicleId !== undefined ? { vehicleId: input.vehicleId } : {}),
          ...(input.driverId !== undefined ? { driverId: input.driverId } : {}),
          ...(input.type !== undefined ? { type: input.type as FleetExpenseType } : {}),
          ...(input.amount !== undefined ? { amount: new Prisma.Decimal(input.amount) } : {}),
          ...(input.occurredAt !== undefined ? { occurredAt: new Date(input.occurredAt) } : {}),
          ...(input.odometer !== undefined ? { odometer: input.odometer } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.cashRegisterId !== undefined
            ? { cashRegisterId: input.cashRegisterId }
            : {}),
        },
      });

      // Reconcilia o movimento de caixa com o estado final.
      if (before.cashMovementId) {
        await this.cashMovements.removeMovement(tenantId, before.cashMovementId, tx);
      }
      let movementId: string | null = null;
      if (finalRegister) {
        movementId = await this.cashMovements.recordExpense({
          tenantId,
          cashRegisterId: finalRegister,
          amount: finalAmount,
          sourceId: id,
          description: finalDescription ?? 'Despesa de frota',
          actorUserId,
          occurredAt: finalOccurredAt,
          tx,
        });
      }
      await tx.fleetExpense.update({
        where: { id },
        data: { cashMovementId: movementId },
      });
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'fleet_expense.updated',
      resource: 'fleet_expenses',
      resourceId: id,
      beforeState: { amount: Number(before.amount), cashRegisterId: before.cashRegisterId },
      afterState: { amount: finalAmount, cashRegisterId: finalRegister },
    });

    return this.findById(tenantId, id);
  }

  async remove(tenantId: string, actorUserId: string, id: string): Promise<void> {
    const before = await this.prisma.fleetExpense.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!before) throw new NotFoundException('Despesa não encontrada');

    await this.prisma.$transaction(async (tx) => {
      if (before.cashMovementId) {
        await this.cashMovements.removeMovement(tenantId, before.cashMovementId, tx);
      }
      await tx.fleetExpense.update({
        where: { id },
        data: { deletedAt: new Date(), cashMovementId: null },
      });
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'fleet_expense.deleted',
      resource: 'fleet_expenses',
      resourceId: id,
      beforeState: { amount: Number(before.amount), cashRegisterId: before.cashRegisterId },
    });
  }

  private async assertVehicle(tenantId: string, vehicleId: string): Promise<void> {
    const v = await this.prisma.vehicle.findFirst({
      where: { id: vehicleId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!v) throw new NotFoundException('Veículo não encontrado');
  }

  private async assertDriver(tenantId: string, driverId: string): Promise<void> {
    const d = await this.prisma.driver.findFirst({
      where: { id: driverId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!d) throw new NotFoundException('Motorista não encontrado');
  }

  private async assertCashRegister(tenantId: string, cashRegisterId: string): Promise<void> {
    const cr = await this.prisma.cashRegister.findFirst({
      where: { id: cashRegisterId, tenantId, deletedAt: null },
      select: { id: true, isActive: true },
    });
    if (!cr) throw new NotFoundException('Caixa não encontrado');
    if (!cr.isActive) throw new BadRequestException('Caixa inativo');
  }
}

function toExpenseResponse(e: ExpenseWithRelations): FleetExpenseResponse {
  return {
    id: e.id,
    tenantId: e.tenantId,
    vehicleId: e.vehicleId,
    driverId: e.driverId,
    type: e.type,
    amount: Number(e.amount),
    occurredAt: e.occurredAt.toISOString(),
    odometer: e.odometer,
    description: e.description,
    cashRegisterId: e.cashRegisterId,
    cashMovementId: e.cashMovementId,
    createdById: e.createdById,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
    vehicle: e.vehicle ? { id: e.vehicle.id, plate: e.vehicle.plate } : null,
    driver: e.driver ? { id: e.driver.id, name: e.driver.name } : null,
    cashRegister: e.cashRegister ? { id: e.cashRegister.id, name: e.cashRegister.name } : null,
  };
}
