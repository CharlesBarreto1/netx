import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ContractStatus as PrismaContractStatus,
  ContractSuspendReason,
  InvoiceStatus as PrismaInvoiceStatus,
  Prisma,
} from '@prisma/client';

import {
  paginationMeta,
  type CancelContractInvoiceRequest,
  type ContractInvoiceResponse,
  type CreateContractInvoiceRequest,
  type InvoiceStatus,
  type ListContractInvoicesQuery,
  type Paginated,
  type PayContractInvoiceRequest,
} from '@netx/shared';

import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CashRegistersService } from '../finance/cash-registers.service';
import { ContractsService } from './contracts.service';

type InvoiceWithContract = Prisma.ContractInvoiceGetPayload<{
  include: {
    contract: {
      select: { id: true; code: true; pppoeUsername: true; customerId: true; status: true };
    };
  };
}>;

@Injectable()
export class ContractInvoicesService {
  private readonly logger = new Logger(ContractInvoicesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly contracts: ContractsService,
    private readonly registers: CashRegistersService,
  ) {}

  // ---------------------------------------------------------------------------
  // READ
  // ---------------------------------------------------------------------------
  async list(
    tenantId: string,
    q: ListContractInvoicesQuery,
  ): Promise<Paginated<ContractInvoiceResponse>> {
    const where: Prisma.ContractInvoiceWhereInput = {
      tenantId,
      ...(q.contractId && { contractId: q.contractId }),
      ...(q.customerId && { contract: { customerId: q.customerId } }),
      ...(q.status && { status: q.status }),
      ...(q.dueFrom && { dueDate: { gte: new Date(`${q.dueFrom}T00:00:00.000Z`) } }),
      ...(q.dueTo && {
        dueDate: {
          ...(q.dueFrom ? { gte: new Date(`${q.dueFrom}T00:00:00.000Z`) } : {}),
          lte: new Date(`${q.dueTo}T00:00:00.000Z`),
        },
      }),
    };
    const skip = (q.page - 1) * q.pageSize;
    const [rows, total] = await Promise.all([
      this.prisma.contractInvoice.findMany({
        where,
        include: {
          contract: {
            select: { id: true, code: true, pppoeUsername: true, customerId: true, status: true },
          },
        },
        orderBy: { [q.sortBy]: q.sortDir },
        skip,
        take: q.pageSize,
      }),
      this.prisma.contractInvoice.count({ where }),
    ]);

    return {
      data: rows.map(toInvoiceResponse),
      pagination: paginationMeta(total, q.page, q.pageSize),
    };
  }

  async findById(tenantId: string, id: string): Promise<ContractInvoiceResponse> {
    const inv = await this.prisma.contractInvoice.findFirst({
      where: { id, tenantId },
      include: {
        contract: {
          select: { id: true, code: true, pppoeUsername: true, customerId: true, status: true },
        },
      },
    });
    if (!inv) throw new NotFoundException('Fatura não encontrada');
    return toInvoiceResponse(inv);
  }

  // ---------------------------------------------------------------------------
  // CREATE (manual; fluxo normal é automático)
  // ---------------------------------------------------------------------------
  async create(
    tenantId: string,
    actorUserId: string,
    contractId: string,
    input: CreateContractInvoiceRequest,
  ): Promise<ContractInvoiceResponse> {
    const contract = await this.prisma.contract.findFirst({
      where: { id: contractId, tenantId, deletedAt: null },
      select: { id: true, status: true },
    });
    if (!contract) throw new NotFoundException('Contrato não encontrado');
    if (contract.status === PrismaContractStatus.CANCELLED) {
      throw new BadRequestException('Contrato cancelado não aceita novas faturas');
    }

    const dueDate = new Date(`${input.dueDate}T00:00:00.000Z`);
    const created = await this.prisma.contractInvoice.create({
      data: {
        tenantId,
        contractId,
        amount: new Prisma.Decimal(input.amount),
        dueDate,
        reference: input.reference ?? null,
        status: PrismaInvoiceStatus.OPEN,
      },
      include: {
        contract: {
          select: { id: true, code: true, pppoeUsername: true, customerId: true, status: true },
        },
      },
    });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'contract_invoices.created',
      resource: 'contract_invoices',
      resourceId: created.id,
      metadata: {
        contractId,
        amount: created.amount.toString(),
        dueDate: created.dueDate.toISOString(),
      },
    });
    return toInvoiceResponse(created);
  }

  // ---------------------------------------------------------------------------
  // PAY (baixa)
  //  - Marca invoice como PAID.
  //  - Se o contrato estava SUSPENDED por OVERDUE_PAYMENT E não há mais faturas
  //    OVERDUE ou OPEN vencidas, reativa automaticamente.
  // ---------------------------------------------------------------------------
  async pay(
    tenantId: string,
    actorUserId: string,
    isManager: boolean,
    canDiscount: boolean,
    id: string,
    input: PayContractInvoiceRequest,
  ): Promise<ContractInvoiceResponse> {
    const existing = await this.prisma.contractInvoice.findFirst({
      where: { id, tenantId },
      include: { contract: true },
    });
    if (!existing) throw new NotFoundException('Fatura não encontrada');
    if (existing.status === PrismaInvoiceStatus.PAID) {
      throw new BadRequestException('Fatura já está paga');
    }
    if (existing.status === PrismaInvoiceStatus.CANCELLED) {
      throw new BadRequestException('Fatura cancelada não pode ser paga');
    }

    // Validações financeiras novas:
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
    const amount = Number(existing.amount);
    const discount = input.discountAmount ?? 0;
    if (discount > amount) {
      throw new BadRequestException(
        'Desconto não pode ser maior que o valor da fatura',
      );
    }
    const paidAt = input.paidAt ? new Date(input.paidAt) : new Date();
    const paidAmount = input.paidAmount ?? amount - discount;

    const updated = await this.prisma.contractInvoice.update({
      where: { id },
      data: {
        status: PrismaInvoiceStatus.PAID,
        paidAt,
        paidAmount: new Prisma.Decimal(paidAmount),
        discountAmount: discount > 0 ? new Prisma.Decimal(discount) : null,
        paidVia: input.paidVia,
        cashRegisterId: input.cashRegisterId ?? null,
        paymentNote: input.note ?? null,
      },
      include: {
        contract: {
          select: { id: true, code: true, pppoeUsername: true, customerId: true, status: true },
        },
      },
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'contract_invoices.paid',
      resource: 'contract_invoices',
      resourceId: updated.id,
      metadata: {
        contractId: existing.contractId,
        paidAmount,
        paidAt: paidAt.toISOString(),
      },
    });

    // Reativação automática (baixa é instantânea por requisito).
    if (
      existing.contract.status === PrismaContractStatus.SUSPENDED &&
      existing.contract.suspendReason === ContractSuspendReason.OVERDUE_PAYMENT
    ) {
      const stillOverdue = await this.prisma.contractInvoice.count({
        where: {
          tenantId,
          contractId: existing.contractId,
          status: { in: [PrismaInvoiceStatus.OPEN, PrismaInvoiceStatus.OVERDUE] },
          dueDate: { lt: new Date() },
        },
      });
      if (stillOverdue === 0) {
        await this.contracts.applyReactivate(tenantId, existing.contractId, {
          actorUserId,
          note: `baixa da fatura ${id}`,
        });
      }
    }
    return toInvoiceResponse(updated);
  }

  // ---------------------------------------------------------------------------
  // CANCEL
  // ---------------------------------------------------------------------------
  async cancel(
    tenantId: string,
    actorUserId: string,
    id: string,
    input: CancelContractInvoiceRequest,
  ): Promise<ContractInvoiceResponse> {
    const existing = await this.prisma.contractInvoice.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('Fatura não encontrada');
    if (existing.status === PrismaInvoiceStatus.PAID) {
      throw new BadRequestException('Fatura paga não pode ser cancelada');
    }
    const updated = await this.prisma.contractInvoice.update({
      where: { id },
      data: {
        status: PrismaInvoiceStatus.CANCELLED,
        paymentNote: input.note ?? null,
      },
      include: {
        contract: {
          select: { id: true, code: true, pppoeUsername: true, customerId: true, status: true },
        },
      },
    });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'contract_invoices.cancelled',
      resource: 'contract_invoices',
      resourceId: updated.id,
      metadata: { note: input.note ?? null },
    });
    return toInvoiceResponse(updated);
  }
}

// ---------------------------------------------------------------------------
// MAPPER
// ---------------------------------------------------------------------------
function toInvoiceResponse(i: InvoiceWithContract): ContractInvoiceResponse {
  return {
    id: i.id,
    tenantId: i.tenantId,
    contractId: i.contractId,
    amount: Number(i.amount),
    dueDate: i.dueDate.toISOString().slice(0, 10),
    issuedAt: i.issuedAt.toISOString(),
    status: i.status as InvoiceStatus,
    paidAt: i.paidAt?.toISOString() ?? null,
    paidAmount: i.paidAmount != null ? Number(i.paidAmount) : null,
    discountAmount:
      (i as any).discountAmount != null ? Number((i as any).discountAmount) : null,
    paidVia: (i as any).paidVia ?? null,
    cashRegisterId: (i as any).cashRegisterId ?? null,
    paymentNote: i.paymentNote,
    reference: i.reference,
    createdAt: i.createdAt.toISOString(),
    updatedAt: i.updatedAt.toISOString(),
    contract: i.contract
      ? {
          id: i.contract.id,
          code: i.contract.code,
          pppoeUsername: i.contract.pppoeUsername,
          customerId: i.contract.customerId,
        }
      : undefined,
  };
}
