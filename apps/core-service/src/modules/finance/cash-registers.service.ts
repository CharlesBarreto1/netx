import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import {
  type AddCashRegisterMemberRequest,
  type CashRegisterMemberResponse,
  type CashRegisterResponse,
  type CreateCashRegisterRequest,
  type ListCashRegistersQuery,
  type UpdateCashRegisterRequest,
} from '@netx/shared';

import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

/**
 * Caixas + memberships.
 *
 * Decisões:
 *
 * 1. Visibilidade.
 *    - Admin (perm `cash_registers.manage`): vê tudo.
 *    - Demais users: só veem caixas em que têm membership ativa.
 *    O frontend passa `isManager` no helper `assertVisible` pra evitar
 *    refazer a query de perm aqui.
 *
 * 2. Soft-delete.
 *    Não há soft-delete físico — usamos `isActive=false` e o list filtra.
 *    Isso preserva FKs em ContractInvoice.cashRegisterId/OneTimeCharge.
 *
 * 3. Membership.
 *    Composite PK (cashRegisterId, userId). Replace strategy: o admin
 *    chama `addMember` várias vezes (idempotente — upsert), e remove via
 *    `removeMember`.
 */
@Injectable()
export class CashRegistersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------
  async create(
    tenantId: string,
    actorUserId: string,
    input: CreateCashRegisterRequest,
  ): Promise<CashRegisterResponse> {
    // Currency default = currency do tenant.
    let currency = input.currency;
    if (!currency) {
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: tenantId },
      });
      currency = tenant?.currency ?? 'BRL';
    }

    // Caixa nunca nasce órfão: sem operadores indicados, o criador vira
    // operador. Um caixa sem membership só é visível/operável por admins e
    // some da tela de recebimento dos demais usuários.
    const operatorUserIds =
      input.operatorUserIds.length > 0 ? input.operatorUserIds : [actorUserId];

    try {
      const created = await this.prisma.cashRegister.create({
        data: {
          tenantId,
          name: input.name.trim(),
          description: input.description ?? null,
          type: input.type,
          color: input.color ?? null,
          currency,
          isActive: input.isActive,
          openingBalance: new Prisma.Decimal(input.openingBalance ?? 0),
          memberships: {
            create: operatorUserIds.map((uid) => ({
              userId: uid,
              role: 'OPERATOR' as const,
            })),
          },
        },
      });
      await this.audit.log({
        tenantId,
        userId: actorUserId,
        action: 'cash_register.created',
        resource: 'cash_registers',
        resourceId: created.id,
        afterState: { name: created.name, type: created.type },
      });
      return toResponse(created);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(`Já existe um caixa "${input.name}"`);
      }
      throw err;
    }
  }

  async list(
    tenantId: string,
    actorUserId: string,
    isManager: boolean,
    q: ListCashRegistersQuery,
  ): Promise<CashRegisterResponse[]> {
    const where: Prisma.CashRegisterWhereInput = {
      tenantId,
      deletedAt: null,
      ...(q.includeInactive && isManager ? {} : { isActive: true }),
      // Não-admin: filtra por membership.
      ...(isManager
        ? {}
        : { memberships: { some: { userId: actorUserId } } }),
    };
    const rows = await this.prisma.cashRegister.findMany({
      where,
      orderBy: { name: 'asc' },
    });
    return rows.map(toResponse);
  }

  async findById(
    tenantId: string,
    actorUserId: string,
    isManager: boolean,
    id: string,
  ): Promise<CashRegisterResponse> {
    const row = await this.prisma.cashRegister.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: {
        memberships: {
          include: {
            user: {
              select: { id: true, firstName: true, lastName: true, email: true },
            },
          },
        },
      },
    });
    if (!row) throw new NotFoundException('Caixa não encontrado');
    if (!isManager) {
      const isMember = row.memberships.some((m) => m.userId === actorUserId);
      if (!isMember)
        throw new ForbiddenException('Sem acesso a este caixa');
    }
    return {
      ...toResponse(row),
      members: row.memberships.map(toMemberResponse),
    };
  }

  async update(
    tenantId: string,
    actorUserId: string,
    id: string,
    input: UpdateCashRegisterRequest,
  ): Promise<CashRegisterResponse> {
    const before = await this.prisma.cashRegister.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!before) throw new NotFoundException('Caixa não encontrado');

    try {
      const updated = await this.prisma.cashRegister.update({
        where: { id },
        data: {
          name: input.name?.trim(),
          description: input.description,
          type: input.type,
          color: input.color,
          currency: input.currency,
          isActive: input.isActive,
          openingBalance:
            input.openingBalance !== undefined
              ? new Prisma.Decimal(input.openingBalance)
              : undefined,
        },
      });
      await this.audit.log({
        tenantId,
        userId: actorUserId,
        action: 'cash_register.updated',
        resource: 'cash_registers',
        resourceId: id,
        beforeState: { name: before.name, isActive: before.isActive },
        afterState: { name: updated.name, isActive: updated.isActive },
      });
      return toResponse(updated);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(`Já existe um caixa "${input.name}"`);
      }
      throw err;
    }
  }

  /** Soft-delete via isActive=false (para preservar FKs). */
  async deactivate(
    tenantId: string,
    actorUserId: string,
    id: string,
  ): Promise<void> {
    const before = await this.prisma.cashRegister.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!before) throw new NotFoundException('Caixa não encontrado');
    if (!before.isActive) return;

    await this.prisma.cashRegister.update({
      where: { id },
      data: { isActive: false },
    });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'cash_register.deactivated',
      resource: 'cash_registers',
      resourceId: id,
    });
  }

  // ---------------------------------------------------------------------------
  // MEMBERSHIPS
  // ---------------------------------------------------------------------------
  async addMember(
    tenantId: string,
    actorUserId: string,
    cashRegisterId: string,
    input: AddCashRegisterMemberRequest,
  ): Promise<CashRegisterMemberResponse> {
    const cr = await this.prisma.cashRegister.findFirst({
      where: { id: cashRegisterId, tenantId, deletedAt: null },
    });
    if (!cr) throw new NotFoundException('Caixa não encontrado');

    const user = await this.prisma.user.findFirst({
      where: { id: input.userId, tenantId, deletedAt: null },
      select: { id: true, firstName: true, lastName: true, email: true },
    });
    if (!user) throw new NotFoundException('Usuário não encontrado');

    // Upsert pra ser idempotente.
    const m = await this.prisma.cashRegisterMembership.upsert({
      where: {
        cashRegisterId_userId: { cashRegisterId, userId: input.userId },
      },
      update: { role: input.role },
      create: { cashRegisterId, userId: input.userId, role: input.role },
    });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'cash_register.member_added',
      resource: 'cash_registers',
      resourceId: cashRegisterId,
      afterState: { userId: input.userId, role: input.role },
    });
    return {
      userId: m.userId,
      role: m.role,
      user,
      createdAt: m.createdAt.toISOString(),
    };
  }

  async removeMember(
    tenantId: string,
    actorUserId: string,
    cashRegisterId: string,
    userId: string,
  ): Promise<void> {
    const cr = await this.prisma.cashRegister.findFirst({
      where: { id: cashRegisterId, tenantId, deletedAt: null },
    });
    if (!cr) throw new NotFoundException('Caixa não encontrado');

    await this.prisma.cashRegisterMembership.deleteMany({
      where: { cashRegisterId, userId },
    });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'cash_register.member_removed',
      resource: 'cash_registers',
      resourceId: cashRegisterId,
      afterState: { userId },
    });
  }

  // ---------------------------------------------------------------------------
  // HELPER PRA OUTROS SERVICES
  // ---------------------------------------------------------------------------
  /**
   * Verifica se `userId` pode operar (gravar pagamento) no `cashRegisterId`.
   * Usado por ContractInvoicesService.pay e OneTimeChargesService.pay.
   * Admins bypassam via `isManager=true`.
   */
  async assertOperator(
    tenantId: string,
    cashRegisterId: string,
    userId: string,
    isManager: boolean,
  ): Promise<void> {
    const cr = await this.prisma.cashRegister.findFirst({
      where: { id: cashRegisterId, tenantId, deletedAt: null, isActive: true },
    });
    if (!cr) throw new NotFoundException('Caixa não encontrado ou inativo');
    if (isManager) return;

    const m = await this.prisma.cashRegisterMembership.findUnique({
      where: { cashRegisterId_userId: { cashRegisterId, userId } },
    });
    if (!m || m.role !== 'OPERATOR') {
      throw new ForbiddenException('Você não opera este caixa');
    }
  }
}

// =============================================================================
// MAPPERS
// =============================================================================
function toResponse(r: any): CashRegisterResponse {
  return {
    id: r.id,
    tenantId: r.tenantId,
    name: r.name,
    description: r.description,
    type: r.type,
    color: r.color,
    currency: r.currency,
    isActive: r.isActive,
    openingBalance: Number(r.openingBalance),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function toMemberResponse(m: any): CashRegisterMemberResponse {
  return {
    userId: m.userId,
    role: m.role,
    user: {
      id: m.user.id,
      firstName: m.user.firstName,
      lastName: m.user.lastName,
      email: m.user.email,
    },
    createdAt: m.createdAt.toISOString(),
  };
}
