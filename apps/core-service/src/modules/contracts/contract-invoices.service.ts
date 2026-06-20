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
  InvoiceKind as PrismaInvoiceKind,
  InvoiceStatus as PrismaInvoiceStatus,
  PaymentMode as PrismaPaymentMode,
  Prisma,
} from '@prisma/client';

import {
  paginationMeta,
  type CancelContractInvoiceRequest,
  type ContractInvoiceResponse,
  type CreateContractInvoiceRequest,
  type InvoiceKind,
  type InvoiceStatus,
  type ListContractInvoicesQuery,
  type Paginated,
  type PayContractInvoiceRequest,
} from '@netx/shared';

import { nextPrepaidDate } from './billing-period.util';

import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CashMovementsService } from '../finance/cash-movements.service';
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
    private readonly movements: CashMovementsService,
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

    // Registra movimento no caixa quando a fatura foi paga em algum caixa.
    if (input.cashRegisterId) {
      await this.movements.recordIncome({
        tenantId,
        cashRegisterId: input.cashRegisterId,
        amount: paidAmount,
        source: 'INVOICE',
        sourceId: updated.id,
        description: existing.reference ?? `Fatura ${updated.id.slice(0, 8)}`,
        actorUserId,
        occurredAt: paidAt,
      });
    }

    // PREPAID: avança o ciclo após pagamento confirmado de fatura cobrável.
    // CREDIT/PRORATION não avançam o ciclo — são ajustes financeiros, não
    // pagamento de mensalidade. Só REGULAR/INITIAL deslocam prepaidUntil.
    if (
      existing.contract.paymentMode === PrismaPaymentMode.PREPAID &&
      (existing.kind === PrismaInvoiceKind.REGULAR ||
        existing.kind === PrismaInvoiceKind.INITIAL)
    ) {
      // periodEnd já é EXCLUSIVO (= próximo vencimento). Quitar a fatura
      // significa estar pago ATÉ periodEnd, logo prepaidUntil = periodEnd.
      // NÃO avançar +1 mês aqui — periodEnd já é o início do próximo ciclo
      // (avançar duplicava e pulava um mês de cobrança). Sem periodEnd
      // (faturas manuais antigas) cai no fallback que avança a partir do
      // vencimento atual / data do pagamento.
      const newPrepaidUntil = existing.periodEnd
        ? existing.periodEnd
        : nextPrepaidDate(existing.contract.prepaidUntil ?? paidAt, 1);
      await this.prisma.contract.update({
        where: { id: existing.contractId },
        data: { prepaidUntil: newPrepaidUntil },
      });
      this.logger.log(
        `[invoice.pay] PREPAID contract=${existing.contractId} ` +
          `prepaidUntil avançou pra ${newPrepaidUntil.toISOString().slice(0, 10)}`,
      );
    }

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
  // UNPAY (estorno da baixa) — desfaz o pagamento de uma fatura paga errada.
  //  - Volta o status pra OVERDUE (se vencida) ou OPEN.
  //  - Estorna o movimento de caixa criado na baixa (se houve).
  //  - PREPAID: desfaz o avanço do prepaidUntil.
  //  - NÃO re-suspende o contrato: se a fatura voltar a vencida, o OverdueScan
  //    re-suspende na próxima varredura (re-suspender aqui poderia cortar o
  //    cliente indevidamente).
  // ---------------------------------------------------------------------------
  async unpay(
    tenantId: string,
    actorUserId: string,
    id: string,
  ): Promise<ContractInvoiceResponse> {
    const existing = await this.prisma.contractInvoice.findFirst({
      where: { id, tenantId },
      include: { contract: true },
    });
    if (!existing) throw new NotFoundException('Fatura não encontrada');
    if (existing.status !== PrismaInvoiceStatus.PAID) {
      throw new BadRequestException('Só dá pra estornar uma fatura paga');
    }

    const wasPrepaidCycle =
      existing.contract.paymentMode === PrismaPaymentMode.PREPAID &&
      (existing.kind === PrismaInvoiceKind.REGULAR ||
        existing.kind === PrismaInvoiceKind.INITIAL);
    const nextStatus =
      existing.dueDate.getTime() < Date.now()
        ? PrismaInvoiceStatus.OVERDUE
        : PrismaInvoiceStatus.OPEN;

    const updated = await this.prisma.$transaction(async (tx) => {
      const inv = await tx.contractInvoice.update({
        where: { id },
        data: {
          status: nextStatus,
          paidAt: null,
          paidAmount: null,
          discountAmount: null,
          paidVia: null,
          cashRegisterId: null,
          paymentNote: null,
        },
        include: {
          contract: {
            select: { id: true, code: true, pppoeUsername: true, customerId: true, status: true },
          },
        },
      });

      // Estorna o movimento de caixa da baixa (hard-delete reverte o saldo).
      const mov = await tx.cashMovement.findFirst({
        where: { tenantId, source: 'INVOICE', sourceId: id },
        select: { id: true },
      });
      if (mov) await this.movements.removeMovement(tenantId, mov.id, tx);

      // PREPAID: desfaz o avanço do ciclo. pay() deixou prepaidUntil =
      // periodEnd; estornar volta pro periodStart (vencimento desta fatura,
      // que era o prepaidUntil anterior ao pagamento).
      if (wasPrepaidCycle && existing.contract.prepaidUntil) {
        const revertTo =
          existing.periodStart ??
          nextPrepaidDate(existing.contract.prepaidUntil, -1);
        await tx.contract.update({
          where: { id: existing.contractId },
          data: { prepaidUntil: revertTo },
        });
      }
      return inv;
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'contract_invoices.payment_reversed',
      resource: 'contract_invoices',
      resourceId: id,
      beforeState: { status: 'PAID', paidAmount: Number(existing.paidAmount ?? 0) },
      afterState: { status: nextStatus },
    });
    return toInvoiceResponse(updated);
  }

  // ---------------------------------------------------------------------------
  // BAIXA VIA GATEWAY (EFI — Pix/Bolix)
  //  - Chamado pelo webhook do EFI quando a cobrança é confirmada paga.
  //  - Não envolve caixa (cashRegister) — é recebimento digital direto.
  //  - Idempotente: fatura já PAID retorna sem efeito (webhooks repetem).
  //  - Reusa a mesma lógica de avanço PREPAID + reativação automática do
  //    contrato suspenso por inadimplência que o pay() manual aplica.
  // ---------------------------------------------------------------------------
  async registerGatewayPayment(
    tenantId: string,
    invoiceId: string,
    input: {
      paidAmount: number;
      paidAt: Date;
      paidVia: 'PIX' | 'BOLETO';
      gatewayRef: string;
    },
  ): Promise<void> {
    const existing = await this.prisma.contractInvoice.findFirst({
      where: { id: invoiceId, tenantId },
      include: { contract: true },
    });
    if (!existing) {
      this.logger.warn(`[gateway-pay] fatura ${invoiceId} não encontrada (tenant ${tenantId})`);
      return;
    }
    if (existing.status === PrismaInvoiceStatus.PAID) return; // idempotência
    if (existing.status === PrismaInvoiceStatus.CANCELLED) {
      this.logger.warn(`[gateway-pay] fatura ${invoiceId} CANCELADA — pagamento EFI ignorado`);
      return;
    }

    await this.prisma.contractInvoice.update({
      where: { id: invoiceId },
      data: {
        status: PrismaInvoiceStatus.PAID,
        paidAt: input.paidAt,
        paidAmount: new Prisma.Decimal(input.paidAmount),
        paidVia: input.paidVia,
        cashRegisterId: null,
        paymentNote: `EFI ${input.paidVia} ref ${input.gatewayRef}`.slice(0, 255),
      },
    });

    await this.audit.log({
      tenantId,
      action: 'contract_invoices.paid',
      actor: 'webhook:efi',
      resource: 'contract_invoices',
      resourceId: invoiceId,
      metadata: {
        contractId: existing.contractId,
        paidAmount: input.paidAmount,
        paidAt: input.paidAt.toISOString(),
        via: input.paidVia,
        gatewayRef: input.gatewayRef,
      },
    });

    // PREPAID: avança o ciclo (mesma regra do pay() manual).
    if (
      existing.contract.paymentMode === PrismaPaymentMode.PREPAID &&
      (existing.kind === PrismaInvoiceKind.REGULAR ||
        existing.kind === PrismaInvoiceKind.INITIAL)
    ) {
      // Mesma regra do pay() manual: periodEnd é exclusivo (= próximo
      // vencimento), não avançar +1 mês quando ele existe.
      const newPrepaidUntil = existing.periodEnd
        ? existing.periodEnd
        : nextPrepaidDate(existing.contract.prepaidUntil ?? input.paidAt, 1);
      await this.prisma.contract.update({
        where: { id: existing.contractId },
        data: { prepaidUntil: newPrepaidUntil },
      });
    }

    // Reativação automática se estava suspenso por inadimplência.
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
          note: `baixa automática EFI da fatura ${invoiceId}`,
        });
      }
    }
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

  // ---------------------------------------------------------------------------
  // DESCONTO PRÉVIO (sem pagar)
  // ---------------------------------------------------------------------------
  /**
   * Define um desconto que será aplicado quando a fatura for paga. NÃO
   * altera status — fatura continua OPEN. O PaymentDialog lê este valor
   * como default ao abrir.
   *
   * Passar `discountAmount = 0` zera o desconto. Não pode exceder amount.
   */
  async applyDiscount(
    tenantId: string,
    actorUserId: string,
    id: string,
    discountAmount: number,
    note?: string,
  ): Promise<ContractInvoiceResponse> {
    const inv = await this.prisma.contractInvoice.findFirst({
      where: { id, tenantId },
    });
    if (!inv) throw new NotFoundException('Fatura não encontrada');
    if (inv.status === 'PAID' || inv.status === 'CANCELLED') {
      throw new BadRequestException(
        'Não é possível alterar desconto de fatura paga ou cancelada',
      );
    }
    const amountNum = Number(inv.amount);
    if (discountAmount < 0) {
      throw new BadRequestException('Desconto não pode ser negativo');
    }
    if (discountAmount > amountNum) {
      throw new BadRequestException('Desconto maior que o valor da fatura');
    }

    const updated = await this.prisma.contractInvoice.update({
      where: { id: inv.id },
      data: {
        discountAmount:
          discountAmount > 0 ? new Prisma.Decimal(discountAmount) : null,
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
      action: 'contract_invoices.discount_applied',
      resource: 'contract_invoices',
      resourceId: updated.id,
      beforeState: {
        discountAmount: inv.discountAmount ? Number(inv.discountAmount) : null,
      },
      afterState: { discountAmount },
      metadata: { note: note ?? null },
    });

    return toInvoiceResponse(updated);
  }

  // ---------------------------------------------------------------------------
  // PRORROGAR (mudar vencimento sem pagar)
  // ---------------------------------------------------------------------------
  /**
   * Move a `dueDate` da fatura pra frente. Cobre dois casos:
   *
   *   1. OPEN/OVERDUE → muda dueDate, fatura volta a OPEN se estava OVERDUE.
   *   2. Se o contrato estava SUSPENDED por OVERDUE_PAYMENT e essa era a
   *      única fatura vencida, reativa o contrato (idêntico ao fluxo do
   *      pagamento parcial em ContractsService).
   *
   * NÃO altera `paidAt`/`paidAmount`. NÃO cria CashMovement (não houve
   * pagamento). Audit log captura before/after.
   */
  async postpone(
    tenantId: string,
    actorUserId: string,
    id: string,
    newDueDateIso: string,
    note?: string,
  ): Promise<ContractInvoiceResponse> {
    const inv = await this.prisma.contractInvoice.findFirst({
      where: { id, tenantId },
      include: {
        contract: {
          select: { id: true, status: true, suspendReason: true },
        },
      },
    });
    if (!inv) throw new NotFoundException('Fatura não encontrada');
    if (inv.status === 'PAID' || inv.status === 'CANCELLED') {
      throw new BadRequestException('Não é possível prorrogar fatura paga ou cancelada');
    }

    const newDate = new Date(`${newDueDateIso}T00:00:00.000Z`);
    if (Number.isNaN(newDate.getTime())) {
      throw new BadRequestException('Data inválida');
    }
    if (newDate <= inv.dueDate) {
      throw new BadRequestException('Nova data deve ser posterior ao vencimento atual');
    }

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    // Se a nova data ainda é futura, fatura volta a OPEN. Se já passou,
    // mantém OVERDUE (improvável, mas defensivo).
    const newStatus =
      newDate >= today ? PrismaInvoiceStatus.OPEN : PrismaInvoiceStatus.OVERDUE;

    const updated = await this.prisma.contractInvoice.update({
      where: { id: inv.id },
      data: { dueDate: newDate, status: newStatus },
      include: {
        contract: {
          select: {
            id: true, code: true, pppoeUsername: true, customerId: true, status: true,
          },
        },
      },
    });

    // Reativa contrato se ele estava suspenso por overdue E essa era a
    // única fatura vencida não-paga. Delegamos pro ContractsService que
    // já cuida do RADIUS sync. Fora da transação porque applyReactivate
    // tem sua própria.
    if (
      inv.contract?.status === 'SUSPENDED' &&
      inv.contract.suspendReason === 'OVERDUE_PAYMENT'
    ) {
      const stillOverdue = await this.prisma.contractInvoice.count({
        where: {
          contractId: inv.contractId,
          status: 'OVERDUE',
          id: { not: inv.id },
        },
      });
      if (stillOverdue === 0) {
        await this.contracts.applyReactivate(tenantId, inv.contract.id, {
          actorUserId,
          note: 'reativação por prorrogação de fatura',
        });
      }
    }

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'contract_invoices.postponed',
      resource: 'contract_invoices',
      resourceId: updated.id,
      beforeState: {
        dueDate: inv.dueDate.toISOString().slice(0, 10),
        status: inv.status,
      },
      afterState: {
        dueDate: newDate.toISOString().slice(0, 10),
        status: newStatus,
      },
      metadata: { note: note ?? null },
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
    kind: i.kind as InvoiceKind,
    periodStart: i.periodStart ? i.periodStart.toISOString().slice(0, 10) : null,
    periodEnd: i.periodEnd ? i.periodEnd.toISOString().slice(0, 10) : null,
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
