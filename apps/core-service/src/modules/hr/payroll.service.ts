import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PaymentMethod, PayslipStatus, Prisma } from '@prisma/client';
import {
  paginationMeta,
  type CreatePayslipRequest,
  type ListPayslipsQuery,
  type Paginated,
  type PaySalaryRequest,
  type PayslipItem,
  type PayslipResponse,
  type SalaryPaymentResponse,
  type UpdatePayslipRequest,
} from '@netx/shared';

import { AuditService } from '../audit/audit.service';
import { CashMovementsService } from '../finance/cash-movements.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

const payslipInclude = {
  employee: { select: { id: true, fullName: true } },
  payment: true,
} satisfies Prisma.PayslipInclude;

type PayslipRow = Prisma.PayslipGetPayload<{ include: typeof payslipInclude }>;

@Injectable()
export class PayrollService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly cashMovements: CashMovementsService,
    private readonly storage: StorageService,
  ) {}

  // ── Holerites ────────────────────────────────────────────────────────────
  async list(
    tenantId: string,
    q: ListPayslipsQuery,
  ): Promise<Paginated<PayslipResponse>> {
    const where: Prisma.PayslipWhereInput = {
      tenantId,
      deletedAt: null,
      ...(q.employeeId ? { employeeId: q.employeeId } : {}),
      ...(q.status ? { status: q.status as PayslipStatus } : {}),
      ...(q.month ? { referenceMonth: monthToDate(q.month) } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.payslip.findMany({
        where,
        include: payslipInclude,
        orderBy: [{ referenceMonth: 'desc' }, { createdAt: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.payslip.count({ where }),
    ]);
    return {
      data: rows.map(toPayslipResponse),
      pagination: paginationMeta(total, q.page, q.pageSize),
    };
  }

  async findById(tenantId: string, id: string): Promise<PayslipResponse> {
    const p = await this.prisma.payslip.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: payslipInclude,
    });
    if (!p) throw new NotFoundException('Holerite não encontrado');
    return toPayslipResponse(p);
  }

  async create(
    tenantId: string,
    actorUserId: string,
    input: CreatePayslipRequest,
  ): Promise<PayslipResponse> {
    await this.assertEmployee(tenantId, input.employeeId);
    const referenceMonth = monthToDate(input.referenceMonth);

    const dup = await this.prisma.payslip.findFirst({
      where: { tenantId, employeeId: input.employeeId, referenceMonth, deletedAt: null },
      select: { id: true },
    });
    if (dup) {
      throw new ConflictException(
        'Já existe holerite para este colaborador nesta competência.',
      );
    }

    const totals = computeTotals(input.items);
    const p = await this.prisma.payslip.create({
      data: {
        tenantId,
        employeeId: input.employeeId,
        referenceMonth,
        items: input.items as unknown as Prisma.InputJsonValue,
        grossAmount: totals.gross,
        deductionsTotal: totals.deductions,
        netAmount: totals.net,
        notes: input.notes ?? null,
        createdById: actorUserId,
      },
      include: payslipInclude,
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'payslip.created',
      resource: 'payslips',
      resourceId: p.id,
      afterState: { employeeId: input.employeeId, net: totals.net },
    });

    return toPayslipResponse(p);
  }

  async update(
    tenantId: string,
    actorUserId: string,
    id: string,
    input: UpdatePayslipRequest,
  ): Promise<PayslipResponse> {
    const before = await this.getEditable(tenantId, id);
    const data: Prisma.PayslipUpdateInput = {};
    if (input.items !== undefined) {
      const totals = computeTotals(input.items);
      data.items = input.items as unknown as Prisma.InputJsonValue;
      data.grossAmount = totals.gross;
      data.deductionsTotal = totals.deductions;
      data.netAmount = totals.net;
    }
    if (input.notes !== undefined) data.notes = input.notes;
    if (input.storageKey !== undefined) data.storageKey = input.storageKey;

    const p = await this.prisma.payslip.update({
      where: { id: before.id },
      data,
      include: payslipInclude,
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'payslip.updated',
      resource: 'payslips',
      resourceId: id,
    });
    return toPayslipResponse(p);
  }

  async approve(
    tenantId: string,
    actorUserId: string,
    id: string,
  ): Promise<PayslipResponse> {
    const before = await this.getEditable(tenantId, id);
    const p = await this.prisma.payslip.update({
      where: { id: before.id },
      data: { status: PayslipStatus.APPROVED },
      include: payslipInclude,
    });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'payslip.approved',
      resource: 'payslips',
      resourceId: id,
    });
    return toPayslipResponse(p);
  }

  async remove(tenantId: string, actorUserId: string, id: string): Promise<void> {
    const p = await this.prisma.payslip.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: { payment: { select: { id: true } } },
    });
    if (!p) throw new NotFoundException('Holerite não encontrado');
    if (p.payment) {
      throw new ConflictException(
        'Holerite já pago — estorne o pagamento antes de excluir.',
      );
    }
    await this.prisma.payslip.update({
      where: { id },
      data: { deletedAt: new Date(), status: PayslipStatus.CANCELLED },
    });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'payslip.deleted',
      resource: 'payslips',
      resourceId: id,
    });
  }

  // ── Pagamento ──────────────────────────────────────────────────────────────
  /**
   * Paga um holerite APPROVED. Cria SalaryPayment e, se cashRegisterId, lança
   * OUTCOME no caixa (source PAYROLL). RADIUS-style: chamada ao caixa fica na
   * mesma tx; em caso de cancelamento o estorno remove o movimento.
   */
  async pay(
    tenantId: string,
    actorUserId: string,
    payslipId: string,
    input: PaySalaryRequest,
  ): Promise<SalaryPaymentResponse> {
    const payslip = await this.prisma.payslip.findFirst({
      where: { id: payslipId, tenantId, deletedAt: null },
      include: { payment: { select: { id: true } } },
    });
    if (!payslip) throw new NotFoundException('Holerite não encontrado');
    if (payslip.payment) {
      throw new ConflictException('Holerite já possui pagamento.');
    }
    if (payslip.status === 'DRAFT') {
      throw new BadRequestException('Aprove o holerite antes de pagar.');
    }
    if (input.cashRegisterId) {
      await this.assertCashRegister(tenantId, input.cashRegisterId);
    }

    const amount = input.amount ?? Number(payslip.netAmount);
    const paidAt = input.paidAt ? new Date(input.paidAt) : new Date();

    const payment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.salaryPayment.create({
        data: {
          tenantId,
          payslipId,
          employeeId: payslip.employeeId,
          amount,
          paidAt,
          method: input.method as PaymentMethod,
          cashRegisterId: input.cashRegisterId ?? null,
          receiptStorageKey: input.receiptStorageKey ?? null,
          notes: input.notes ?? null,
          createdById: actorUserId,
        },
      });

      let cashMovementId: string | null = null;
      if (input.cashRegisterId) {
        cashMovementId = await this.cashMovements.recordExpense({
          tenantId,
          cashRegisterId: input.cashRegisterId,
          amount,
          sourceId: created.id,
          source: 'PAYROLL',
          description: `Salário — holerite ${payslipId}`,
          actorUserId,
          occurredAt: paidAt,
          tx,
        });
        await tx.salaryPayment.update({
          where: { id: created.id },
          data: { cashMovementId },
        });
      }

      await tx.payslip.update({
        where: { id: payslipId },
        data: { status: PayslipStatus.PAID },
      });

      return { ...created, cashMovementId };
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'salary_payment.created',
      resource: 'salary_payments',
      resourceId: payment.id,
      afterState: { payslipId, amount, cashRegisterId: input.cashRegisterId ?? null },
    });

    return toPaymentResponse(payment);
  }

  /** Estorna o pagamento: remove o movimento do caixa e volta holerite p/ APPROVED. */
  async reversePayment(
    tenantId: string,
    actorUserId: string,
    payslipId: string,
  ): Promise<void> {
    const payment = await this.prisma.salaryPayment.findFirst({
      where: { payslipId, tenantId, deletedAt: null },
    });
    if (!payment) throw new NotFoundException('Pagamento não encontrado');

    await this.prisma.$transaction(async (tx) => {
      if (payment.cashMovementId) {
        await this.cashMovements.removeMovement(tenantId, payment.cashMovementId, tx);
      }
      await tx.salaryPayment.delete({ where: { id: payment.id } });
      await tx.payslip.update({
        where: { id: payslipId },
        data: { status: PayslipStatus.APPROVED },
      });
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'salary_payment.reversed',
      resource: 'salary_payments',
      resourceId: payment.id,
      beforeState: { payslipId, amount: Number(payment.amount) },
    });
  }

  /** URL de download do comprovante de pagamento. */
  async receiptUrl(
    tenantId: string,
    payslipId: string,
  ): Promise<{ url: string; expiresIn: number }> {
    const payment = await this.prisma.salaryPayment.findFirst({
      where: { payslipId, tenantId, deletedAt: null },
      select: { receiptStorageKey: true },
    });
    if (!payment?.receiptStorageKey) {
      throw new NotFoundException('Comprovante não anexado.');
    }
    return this.storage.presignDownload(payment.receiptStorageKey);
  }

  // ───────────────────────────────────────────────────────────────────────────
  private async getEditable(tenantId: string, id: string): Promise<PayslipRow> {
    const p = await this.prisma.payslip.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: payslipInclude,
    });
    if (!p) throw new NotFoundException('Holerite não encontrado');
    if (p.status === 'PAID' || p.status === 'CANCELLED') {
      throw new BadRequestException(
        `Holerite ${p.status} não pode ser editado.`,
      );
    }
    return p;
  }

  private async assertEmployee(tenantId: string, id: string): Promise<void> {
    const e = await this.prisma.employee.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!e) throw new NotFoundException('Colaborador não encontrado');
  }

  private async assertCashRegister(tenantId: string, id: string): Promise<void> {
    const cr = await this.prisma.cashRegister.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!cr) throw new NotFoundException('Caixa não encontrado');
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────
/** YYYY-MM → Date no dia 1 (UTC). */
function monthToDate(month: string): Date {
  return new Date(`${month}-01T00:00:00.000Z`);
}

function computeTotals(items: PayslipItem[]): {
  gross: number;
  deductions: number;
  net: number;
} {
  let gross = 0;
  let deductions = 0;
  for (const it of items) {
    if (it.kind === 'EARNING') gross += it.amount;
    else deductions += it.amount;
  }
  return {
    gross: round2(gross),
    deductions: round2(deductions),
    net: round2(gross - deductions),
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function toPaymentResponse(p: {
  id: string;
  tenantId: string;
  payslipId: string;
  employeeId: string;
  amount: Prisma.Decimal | number;
  paidAt: Date;
  method: PaymentMethod;
  cashRegisterId: string | null;
  cashMovementId: string | null;
  receiptStorageKey: string | null;
  notes: string | null;
  createdById: string | null;
  createdAt: Date;
}): SalaryPaymentResponse {
  return {
    id: p.id,
    tenantId: p.tenantId,
    payslipId: p.payslipId,
    employeeId: p.employeeId,
    amount: Number(p.amount),
    paidAt: p.paidAt.toISOString(),
    method: p.method,
    cashRegisterId: p.cashRegisterId,
    cashMovementId: p.cashMovementId,
    receiptStorageKey: p.receiptStorageKey,
    notes: p.notes,
    createdById: p.createdById,
    createdAt: p.createdAt.toISOString(),
  };
}

function toPayslipResponse(p: PayslipRow): PayslipResponse {
  return {
    id: p.id,
    tenantId: p.tenantId,
    employeeId: p.employeeId,
    referenceMonth: p.referenceMonth.toISOString().slice(0, 10),
    items: (p.items as unknown as PayslipItem[]) ?? [],
    grossAmount: Number(p.grossAmount),
    deductionsTotal: Number(p.deductionsTotal),
    netAmount: Number(p.netAmount),
    status: p.status,
    notes: p.notes,
    storageKey: p.storageKey,
    createdById: p.createdById,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    employee: p.employee ? { id: p.employee.id, fullName: p.employee.fullName } : null,
    payment: p.payment ? toPaymentResponse(p.payment) : null,
  };
}
