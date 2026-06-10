import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PayableStatus as PrismaPayableStatus } from '@prisma/client';

import {
  paginationMeta,
  type ListPayablesQuery,
  type Paginated,
  type PayablesSummary,
  type PaySupplierPayableRequest,
  type PurchasePayment,
  type SupplierPayableResponse,
} from '@netx/shared';

import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CashMovementsService } from './cash-movements.service';
import { CashRegistersService } from './cash-registers.service';

/**
 * SupplierPayable — contas a pagar (parcelas de pagamento a fornecedor).
 *
 * Hoje toda parcela nasce do lançamento de compra de estoque (PurchasesService
 * chama createForPurchaseTx dentro da transação da compra):
 *   - à vista: 1 parcela já PAID na data da compra; se veio caixa, lança a
 *     saída (CashMovement OUTCOME, source SUPPLIER_PAYABLE) na mesma transação;
 *   - a prazo: N parcelas OPEN — baixa depois via pay().
 *
 * Regras espelhadas da OneTimeCharge:
 *   - pay() valida operador do caixa (assertOperator) e registra a saída;
 *   - unpay() estorna a baixa (remove o movimento, volta pra OPEN);
 *   - movimento NÃO pode ser revertido direto no caixa (reverseManual bloqueia
 *     sources automáticos) — estorna sempre pela origem.
 */
@Injectable()
export class SupplierPayablesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly registers: CashRegistersService,
    private readonly movements: CashMovementsService,
  ) {}

  // ───────────────────────────────────────────────────────────────────────────
  // LIST / SUMMARY / DETAIL
  // ───────────────────────────────────────────────────────────────────────────
  async list(
    tenantId: string,
    q: ListPayablesQuery,
  ): Promise<Paginated<SupplierPayableResponse>> {
    const where: Prisma.SupplierPayableWhereInput = {
      tenantId,
      ...(q.supplierId ? { supplierId: q.supplierId } : {}),
      ...(q.purchaseId ? { purchaseId: q.purchaseId } : {}),
      ...(q.overdueOnly
        ? { status: 'OPEN', dueDate: { lt: startOfToday() } }
        : q.status
          ? { status: q.status as PrismaPayableStatus }
          : {}),
      ...(q.dueFrom || q.dueTo
        ? {
            dueDate: {
              ...(q.overdueOnly ? { lt: startOfToday() } : {}),
              ...(q.dueFrom ? { gte: new Date(`${q.dueFrom}T00:00:00`) } : {}),
              ...(q.dueTo ? { lte: new Date(`${q.dueTo}T23:59:59`) } : {}),
            },
          }
        : {}),
      ...(q.search
        ? {
            OR: [
              { description: { contains: q.search, mode: 'insensitive' } },
              { supplier: { name: { contains: q.search, mode: 'insensitive' } } },
              {
                purchase: {
                  invoiceNumber: { contains: q.search, mode: 'insensitive' },
                },
              },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.supplierPayable.findMany({
        where,
        include: defaultInclude(),
        orderBy: { [q.sortBy]: q.sortDir },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.supplierPayable.count({ where }),
    ]);

    return {
      data: rows.map(toResponse),
      pagination: paginationMeta(total, q.page, q.pageSize),
    };
  }

  async summary(tenantId: string): Promise<PayablesSummary> {
    const today = startOfToday();
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const [open, overdue, paidMonth] = await Promise.all([
      this.prisma.supplierPayable.aggregate({
        where: { tenantId, status: 'OPEN' },
        _count: true,
        _sum: { amount: true },
      }),
      this.prisma.supplierPayable.aggregate({
        where: { tenantId, status: 'OPEN', dueDate: { lt: today } },
        _count: true,
        _sum: { amount: true },
      }),
      this.prisma.supplierPayable.aggregate({
        where: { tenantId, status: 'PAID', paidAt: { gte: monthStart } },
        _sum: { paidAmount: true },
      }),
    ]);
    return {
      openCount: open._count,
      openTotal: Number(open._sum.amount ?? 0),
      overdueCount: overdue._count,
      overdueTotal: Number(overdue._sum.amount ?? 0),
      paidThisMonthTotal: Number(paidMonth._sum.paidAmount ?? 0),
    };
  }

  async findById(
    tenantId: string,
    id: string,
  ): Promise<SupplierPayableResponse> {
    const row = await this.prisma.supplierPayable.findFirst({
      where: { id, tenantId },
      include: defaultInclude(),
    });
    if (!row) throw new NotFoundException('Conta a pagar não encontrada');
    return toResponse(row);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // PAY / UNPAY
  // ───────────────────────────────────────────────────────────────────────────
  async pay(
    tenantId: string,
    actorUserId: string,
    isManager: boolean,
    id: string,
    input: PaySupplierPayableRequest,
  ): Promise<SupplierPayableResponse> {
    const before = await this.prisma.supplierPayable.findFirst({
      where: { id, tenantId },
      include: { supplier: { select: { name: true } } },
    });
    if (!before) throw new NotFoundException('Conta a pagar não encontrada');
    if (before.status !== 'OPEN')
      throw new ConflictException('Parcela já paga ou cancelada');

    if (input.cashRegisterId) {
      await this.registers.assertOperator(
        tenantId,
        input.cashRegisterId,
        actorUserId,
        isManager,
      );
    }

    const paidAmount = input.paidAmount ?? Number(before.amount);
    const paidAt = input.paidAt ? new Date(input.paidAt) : new Date();

    await this.prisma.$transaction(async (tx) => {
      let cashMovementId: string | null = null;
      if (input.cashRegisterId) {
        cashMovementId = await this.movements.recordExpense({
          tenantId,
          cashRegisterId: input.cashRegisterId,
          amount: paidAmount,
          source: 'SUPPLIER_PAYABLE',
          sourceId: id,
          description:
            before.description ??
            `Pagamento a fornecedor ${before.supplier.name}`,
          actorUserId,
          occurredAt: paidAt,
          tx,
        });
      }
      await tx.supplierPayable.update({
        where: { id },
        data: {
          status: 'PAID',
          paidAt,
          paidAmount: new Prisma.Decimal(paidAmount),
          paidVia: input.paidVia ?? null,
          cashRegisterId: input.cashRegisterId ?? null,
          cashMovementId,
          paymentNote: input.note ?? null,
        },
      });
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'payable.paid',
      resource: 'supplier_payables',
      resourceId: id,
      afterState: {
        paidAmount,
        paidVia: input.paidVia ?? null,
        cashRegisterId: input.cashRegisterId ?? null,
      },
    });
    return this.findById(tenantId, id);
  }

  /** Estorna a baixa de uma parcela paga errada — volta pra OPEN e desfaz o caixa. */
  async unpay(
    tenantId: string,
    actorUserId: string,
    id: string,
  ): Promise<SupplierPayableResponse> {
    const before = await this.prisma.supplierPayable.findFirst({
      where: { id, tenantId },
    });
    if (!before) throw new NotFoundException('Conta a pagar não encontrada');
    if (before.status !== 'PAID')
      throw new ConflictException('Só dá pra estornar uma parcela paga');

    await this.prisma.$transaction(async (tx) => {
      await tx.supplierPayable.update({
        where: { id },
        data: {
          status: 'OPEN',
          paidAt: null,
          paidAmount: null,
          paidVia: null,
          cashRegisterId: null,
          cashMovementId: null,
          paymentNote: null,
        },
      });
      if (before.cashMovementId) {
        await this.movements.removeMovement(tenantId, before.cashMovementId, tx);
      }
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'payable.payment_reversed',
      resource: 'supplier_payables',
      resourceId: id,
      beforeState: { status: 'PAID', paidAmount: Number(before.paidAmount ?? 0) },
      afterState: { status: 'OPEN' },
    });
    return this.findById(tenantId, id);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // INTEGRAÇÃO COM COMPRAS (chamado pelo PurchasesService)
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Validações ANTES da transação da compra: soma das parcelas bate com o
   * total e, na compra à vista com caixa, o user opera o caixa.
   */
  async validatePurchasePayment(
    tenantId: string,
    actorUserId: string,
    isManager: boolean,
    payment: PurchasePayment,
    totalCost: number,
  ): Promise<void> {
    if (payment.condition === 'INSTALLMENTS') {
      const sum = (payment.installments ?? []).reduce(
        (acc, p) => acc + p.amount,
        0,
      );
      // Tolerância de 1 centavo pra arredondamento da divisão das parcelas.
      if (Math.abs(sum - totalCost) > 0.01) {
        throw new BadRequestException(
          `Soma das parcelas (${sum.toFixed(2)}) difere do total da compra (${totalCost.toFixed(2)})`,
        );
      }
    } else if (payment.cashRegisterId) {
      await this.registers.assertOperator(
        tenantId,
        payment.cashRegisterId,
        actorUserId,
        isManager,
      );
    }
  }

  /**
   * Cria as parcelas da compra DENTRO da transação dela. À vista com caixa
   * também lança a saída — se o caixa falhar, a compra inteira reverte.
   */
  async createForPurchaseTx(
    tx: Prisma.TransactionClient,
    params: {
      tenantId: string;
      actorUserId: string;
      purchaseId: string;
      supplierId: string;
      supplierName: string;
      invoiceNumber: string | null;
      purchaseDate: Date;
      totalCost: number;
      payment: PurchasePayment;
    },
  ): Promise<void> {
    const {
      tenantId,
      actorUserId,
      purchaseId,
      supplierId,
      supplierName,
      invoiceNumber,
      purchaseDate,
      totalCost,
      payment,
    } = params;

    const ref = invoiceNumber
      ? `NF ${invoiceNumber}`
      : `compra de ${purchaseDate.toISOString().slice(0, 10)}`;

    if (payment.condition === 'CASH') {
      const payable = await tx.supplierPayable.create({
        data: {
          tenantId,
          supplierId,
          purchaseId,
          description: `${supplierName} — ${ref} (à vista)`,
          installmentNumber: 1,
          installmentCount: 1,
          amount: new Prisma.Decimal(totalCost),
          dueDate: purchaseDate,
          status: 'PAID',
          paidAt: purchaseDate,
          paidAmount: new Prisma.Decimal(totalCost),
          paidVia: payment.paidVia ?? null,
          cashRegisterId: payment.cashRegisterId ?? null,
          createdById: actorUserId,
        },
      });
      if (payment.cashRegisterId) {
        const movementId = await this.movements.recordExpense({
          tenantId,
          cashRegisterId: payment.cashRegisterId,
          amount: totalCost,
          source: 'SUPPLIER_PAYABLE',
          sourceId: payable.id,
          description: `${supplierName} — ${ref} (à vista)`,
          actorUserId,
          occurredAt: purchaseDate,
          tx,
        });
        await tx.supplierPayable.update({
          where: { id: payable.id },
          data: { cashMovementId: movementId },
        });
      }
      return;
    }

    const installments = payment.installments ?? [];
    let n = 0;
    for (const inst of installments) {
      n += 1;
      await tx.supplierPayable.create({
        data: {
          tenantId,
          supplierId,
          purchaseId,
          description: `${supplierName} — ${ref} (${n}/${installments.length})`,
          installmentNumber: n,
          installmentCount: installments.length,
          amount: new Prisma.Decimal(inst.amount),
          dueDate: new Date(`${inst.dueDate}T00:00:00`),
          status: 'OPEN',
          createdById: actorUserId,
        },
      });
    }
  }

  /**
   * Trava de edição/exclusão da compra: parcela paga prende a compra — o
   * dinheiro já saiu, então estorna a baixa primeiro (unpay) e edita depois.
   */
  async assertPurchaseUnlocked(
    tenantId: string,
    purchaseId: string,
    verb: 'editar' | 'excluir',
  ): Promise<void> {
    const paid = await this.prisma.supplierPayable.count({
      where: { tenantId, purchaseId, status: 'PAID' },
    });
    if (paid > 0) {
      throw new ConflictException(
        `Não dá pra ${verb}: a compra tem ${paid} parcela(s) paga(s) no contas a ` +
          'pagar. Estorne a baixa (contas a pagar → estornar) antes.',
      );
    }
  }

  /** Remove as parcelas da compra dentro da transação dela (edição/exclusão). */
  async deleteForPurchaseTx(
    tx: Prisma.TransactionClient,
    tenantId: string,
    purchaseId: string,
  ): Promise<void> {
    await tx.supplierPayable.deleteMany({ where: { tenantId, purchaseId } });
  }
}

// =============================================================================
// HELPERS
// =============================================================================
function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function defaultInclude() {
  return {
    supplier: { select: { id: true, name: true } },
    purchase: { select: { id: true, invoiceNumber: true } },
    cashRegister: { select: { id: true, name: true } },
    createdBy: { select: { id: true, firstName: true, lastName: true } },
  } as const;
}

function toResponse(p: any): SupplierPayableResponse {
  const isOverdue =
    p.status === 'OPEN' && p.dueDate.getTime() < startOfToday().getTime();
  return {
    id: p.id,
    tenantId: p.tenantId,
    supplierId: p.supplierId,
    supplierName: p.supplier?.name,
    purchaseId: p.purchaseId,
    purchaseInvoiceNumber: p.purchase?.invoiceNumber ?? null,
    description: p.description,
    installmentNumber: p.installmentNumber,
    installmentCount: p.installmentCount,
    amount: Number(p.amount),
    dueDate: p.dueDate.toISOString().slice(0, 10),
    status: p.status,
    isOverdue,
    paidAt: p.paidAt?.toISOString() ?? null,
    paidAmount: p.paidAmount != null ? Number(p.paidAmount) : null,
    paidVia: p.paidVia ?? null,
    cashRegisterId: p.cashRegisterId,
    cashRegisterName: p.cashRegister?.name ?? null,
    paymentNote: p.paymentNote,
    createdById: p.createdById,
    createdByName: [p.createdBy?.firstName, p.createdBy?.lastName]
      .filter(Boolean)
      .join(' ')
      .trim() || undefined,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}
