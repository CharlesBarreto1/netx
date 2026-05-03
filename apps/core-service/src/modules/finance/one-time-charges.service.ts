import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, OneTimeChargeStatus as PrismaStatus } from '@prisma/client';

import {
  paginationMeta,
  type CancelOneTimeChargeRequest,
  type CreateOneTimeChargeRequest,
  type ListOneTimeChargesQuery,
  type OneTimeChargeResponse,
  type Paginated,
  type PayOneTimeChargeRequest,
  type UpdateOneTimeChargeRequest,
} from '@netx/shared';

import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CashRegistersService } from './cash-registers.service';

/**
 * OneTimeCharge — cobrança avulsa (taxa de instalação, multa, equipamento etc).
 *
 * Diferença vs ContractInvoice:
 *   - Não é gerada automaticamente — o operador cria manualmente.
 *   - Pode (mas não precisa) referenciar um Contract.
 *   - Tem o mesmo fluxo de pagamento (caixa + desconto + método).
 *
 * Validações no /pay:
 *   - cashRegisterId: o user precisa ter membership OPERATOR (CashRegistersService.assertOperator)
 *   - discountAmount > 0: exige perm finance.discount.apply (chequeada no controller)
 */
@Injectable()
export class OneTimeChargesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly registers: CashRegistersService,
  ) {}

  async create(
    tenantId: string,
    actorUserId: string,
    input: CreateOneTimeChargeRequest,
  ): Promise<OneTimeChargeResponse> {
    const customer = await this.prisma.customer.findFirst({
      where: { id: input.customerId, tenantId, deletedAt: null },
    });
    if (!customer) throw new NotFoundException('Cliente não encontrado');

    if (input.contractId) {
      const contract = await this.prisma.contract.findFirst({
        where: {
          id: input.contractId,
          tenantId,
          customerId: input.customerId,
          deletedAt: null,
        },
      });
      if (!contract)
        throw new BadRequestException(
          'Contrato não pertence a este cliente ou não existe',
        );
    }

    const code = input.code ?? (await this.nextCode(tenantId));

    let created;
    try {
      created = await this.prisma.oneTimeCharge.create({
        data: {
          tenantId,
          customerId: input.customerId,
          contractId: input.contractId ?? null,
          code,
          description: input.description.trim(),
          amount: new Prisma.Decimal(input.amount),
          dueDate: new Date(`${input.dueDate}T00:00:00`),
          createdById: actorUserId,
          updatedById: actorUserId,
        },
        include: defaultInclude(),
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        // Race no code — retry uma vez.
        const retry = await this.nextCode(tenantId);
        created = await this.prisma.oneTimeCharge.create({
          data: {
            tenantId,
            customerId: input.customerId,
            contractId: input.contractId ?? null,
            code: retry,
            description: input.description.trim(),
            amount: new Prisma.Decimal(input.amount),
            dueDate: new Date(`${input.dueDate}T00:00:00`),
            createdById: actorUserId,
            updatedById: actorUserId,
          },
          include: defaultInclude(),
        });
      } else {
        throw err;
      }
    }

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'charge.created',
      resource: 'one_time_charges',
      resourceId: created.id,
      afterState: { code: created.code, amount: created.amount.toString() },
    });
    return toResponse(created);
  }

  async list(
    tenantId: string,
    q: ListOneTimeChargesQuery,
  ): Promise<Paginated<OneTimeChargeResponse>> {
    const where: Prisma.OneTimeChargeWhereInput = {
      tenantId,
      deletedAt: null,
      ...(q.customerId ? { customerId: q.customerId } : {}),
      ...(q.contractId ? { contractId: q.contractId } : {}),
      ...(q.cashRegisterId ? { cashRegisterId: q.cashRegisterId } : {}),
      ...(q.status ? { status: q.status as PrismaStatus } : {}),
      ...(q.dueFrom || q.dueTo
        ? {
            dueDate: {
              ...(q.dueFrom ? { gte: new Date(`${q.dueFrom}T00:00:00`) } : {}),
              ...(q.dueTo ? { lte: new Date(`${q.dueTo}T23:59:59`) } : {}),
            },
          }
        : {}),
      ...(q.search
        ? {
            OR: [
              { code: { contains: q.search, mode: 'insensitive' } },
              { description: { contains: q.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.oneTimeCharge.findMany({
        where,
        include: defaultInclude(),
        orderBy: { [q.sortBy]: q.sortDir },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.oneTimeCharge.count({ where }),
    ]);

    return {
      data: rows.map(toResponse),
      pagination: paginationMeta(total, q.page, q.pageSize),
    };
  }

  async findById(
    tenantId: string,
    id: string,
  ): Promise<OneTimeChargeResponse> {
    const row = await this.prisma.oneTimeCharge.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: defaultInclude(),
    });
    if (!row) throw new NotFoundException('Cobrança não encontrada');
    return toResponse(row);
  }

  async update(
    tenantId: string,
    actorUserId: string,
    id: string,
    input: UpdateOneTimeChargeRequest,
  ): Promise<OneTimeChargeResponse> {
    const before = await this.prisma.oneTimeCharge.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!before) throw new NotFoundException('Cobrança não encontrada');
    if (before.status !== PrismaStatus.OPEN)
      throw new ConflictException(
        'Cobrança já paga ou cancelada — não pode ser editada',
      );

    const updated = await this.prisma.oneTimeCharge.update({
      where: { id },
      data: {
        description: input.description?.trim(),
        amount:
          input.amount !== undefined ? new Prisma.Decimal(input.amount) : undefined,
        dueDate: input.dueDate
          ? new Date(`${input.dueDate}T00:00:00`)
          : undefined,
        contractId: input.contractId,
        updatedById: actorUserId,
      },
      include: defaultInclude(),
    });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'charge.updated',
      resource: 'one_time_charges',
      resourceId: id,
    });
    return toResponse(updated);
  }

  async pay(
    tenantId: string,
    actorUserId: string,
    isManager: boolean,
    canDiscount: boolean,
    id: string,
    input: PayOneTimeChargeRequest,
  ): Promise<OneTimeChargeResponse> {
    const before = await this.prisma.oneTimeCharge.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!before) throw new NotFoundException('Cobrança não encontrada');
    if (before.status !== PrismaStatus.OPEN)
      throw new ConflictException('Cobrança já paga ou cancelada');

    if (input.discountAmount && input.discountAmount > 0 && !canDiscount) {
      throw new ForbiddenException('Sem permissão para aplicar desconto');
    }

    if (input.cashRegisterId) {
      await this.registers.assertOperator(
        tenantId,
        input.cashRegisterId,
        actorUserId,
        isManager,
      );
    }

    const amount = Number(before.amount);
    const discount = input.discountAmount ?? 0;
    if (discount > amount) {
      throw new BadRequestException(
        'Desconto não pode ser maior que o valor da cobrança',
      );
    }
    const paidAmount = input.paidAmount ?? amount - discount;

    const updated = await this.prisma.oneTimeCharge.update({
      where: { id },
      data: {
        status: PrismaStatus.PAID,
        paidAt: input.paidAt ? new Date(input.paidAt) : new Date(),
        paidAmount: new Prisma.Decimal(paidAmount),
        discountAmount: discount > 0 ? new Prisma.Decimal(discount) : null,
        paidVia: input.paidVia,
        cashRegisterId: input.cashRegisterId ?? null,
        paymentNote: input.note ?? null,
        updatedById: actorUserId,
      },
      include: defaultInclude(),
    });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'charge.paid',
      resource: 'one_time_charges',
      resourceId: id,
      afterState: {
        paidAmount,
        discount,
        paidVia: input.paidVia ?? null,
        cashRegisterId: input.cashRegisterId ?? null,
      },
    });
    return toResponse(updated);
  }

  async cancel(
    tenantId: string,
    actorUserId: string,
    id: string,
    input: CancelOneTimeChargeRequest,
  ): Promise<OneTimeChargeResponse> {
    const before = await this.prisma.oneTimeCharge.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!before) throw new NotFoundException('Cobrança não encontrada');
    if (before.status !== PrismaStatus.OPEN)
      throw new ConflictException(
        'Cobrança já paga ou cancelada — não pode ser cancelada',
      );

    const updated = await this.prisma.oneTimeCharge.update({
      where: { id },
      data: {
        status: PrismaStatus.CANCELLED,
        paymentNote: input.reason ?? null,
        updatedById: actorUserId,
      },
      include: defaultInclude(),
    });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'charge.cancelled',
      resource: 'one_time_charges',
      resourceId: id,
      afterState: { reason: input.reason ?? null },
    });
    return toResponse(updated);
  }

  async remove(tenantId: string, actorUserId: string, id: string): Promise<void> {
    const before = await this.prisma.oneTimeCharge.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!before) throw new NotFoundException('Cobrança não encontrada');

    await this.prisma.oneTimeCharge.update({
      where: { id },
      data: { deletedAt: new Date(), updatedById: actorUserId },
    });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'charge.deleted',
      resource: 'one_time_charges',
      resourceId: id,
    });
  }

  // ---------------------------------------------------------------------------
  private async nextCode(tenantId: string): Promise<string> {
    const count = await this.prisma.oneTimeCharge.count({ where: { tenantId } });
    return `CB-${String(count + 1).padStart(6, '0')}`;
  }
}

// =============================================================================
// HELPERS
// =============================================================================
function defaultInclude() {
  return {
    customer: { select: { id: true, displayName: true } },
    contract: { select: { id: true, code: true } },
    cashRegister: { select: { id: true, name: true } },
  } as const;
}

function toResponse(c: any): OneTimeChargeResponse {
  return {
    id: c.id,
    tenantId: c.tenantId,
    customerId: c.customerId,
    contractId: c.contractId,
    code: c.code,
    description: c.description,
    amount: Number(c.amount),
    dueDate: c.dueDate.toISOString().slice(0, 10),
    issuedAt: c.issuedAt.toISOString(),
    status: c.status,
    paidAt: c.paidAt?.toISOString() ?? null,
    paidAmount: c.paidAmount != null ? Number(c.paidAmount) : null,
    discountAmount: c.discountAmount != null ? Number(c.discountAmount) : null,
    paidVia: c.paidVia ?? null,
    cashRegisterId: c.cashRegisterId,
    paymentNote: c.paymentNote,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    customer: c.customer
      ? { id: c.customer.id, displayName: c.customer.displayName }
      : null,
    contract: c.contract ? { id: c.contract.id, code: c.contract.code } : null,
    cashRegister: c.cashRegister
      ? { id: c.cashRegister.id, name: c.cashRegister.name }
      : null,
  };
}
