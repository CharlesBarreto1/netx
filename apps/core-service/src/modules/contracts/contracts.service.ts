import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ContractStatus as PrismaContractStatus,
  ContractSuspendReason as PrismaSuspendReason,
  InvoiceStatus,
  Prisma,
} from '@prisma/client';

import {
  paginationMeta,
  type CancelContractRequest,
  type ContractResponse,
  type ContractStatus,
  type ContractSuspendReason,
  type CreateContractRequest,
  type ListContractsQuery,
  type Paginated,
  type ReactivateContractRequest,
  type SuspendContractRequest,
  type UpdateContractRequest,
} from '@netx/shared';

import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { InvoiceGeneratorService } from './invoice-generator.service';
import { RadiusSyncService } from './radius-sync.service';

const DEFAULT_INCLUDE = {
  customer: {
    select: { id: true, displayName: true, type: true },
  },
} as const;

type ContractWithRelations = Prisma.ContractGetPayload<{ include: typeof DEFAULT_INCLUDE }>;

@Injectable()
export class ContractsService {
  private readonly logger = new Logger(ContractsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly invoiceGen: InvoiceGeneratorService,
    private readonly radius: RadiusSyncService,
  ) {}

  // ---------------------------------------------------------------------------
  // CREATE
  // ---------------------------------------------------------------------------
  async create(
    tenantId: string,
    actorUserId: string,
    input: CreateContractRequest,
  ): Promise<ContractResponse> {
    const customer = await this.prisma.customer.findFirst({
      where: { id: input.customerId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!customer) throw new NotFoundException('Cliente não encontrado');

    const firstDue = input.firstDueDate ? new Date(`${input.firstDueDate}T00:00:00.000Z`) : undefined;

    const now = new Date();
    let created: ContractWithRelations;
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const contract = await tx.contract.create({
          data: {
            tenantId,
            customerId: input.customerId,
            code: input.code ?? null,
            pppoeUsername: input.pppoeUsername,
            pppoePassword: input.pppoePassword,
            installationAddress: input.installationAddress,
            installationMapsUrl: input.installationMapsUrl ?? null,
            monthlyValue: new Prisma.Decimal(input.monthlyValue),
            bandwidthMbps: input.bandwidthMbps,
            dueDay: input.dueDay,
            status: PrismaContractStatus.ACTIVE,
            activatedAt: now,
            notes: input.notes ?? null,
            createdById: actorUserId,
            updatedById: actorUserId,
          },
          include: DEFAULT_INCLUDE,
        });

        await this.invoiceGen.generateInitialInvoice(tx, contract, firstDue);
        await this.radius.enqueueSync(contract, 'contrato criado', tx);
        return contract;
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('PPPoE username já em uso neste tenant');
      }
      throw err;
    }

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'contracts.created',
      resource: 'contracts',
      resourceId: created.id,
      afterState: {
        pppoeUsername: created.pppoeUsername,
        monthlyValue: created.monthlyValue.toString(),
        dueDay: created.dueDay,
        bandwidthMbps: created.bandwidthMbps,
      },
    });
    return toContractResponse(created, { includePassword: true });
  }

  // ---------------------------------------------------------------------------
  // READ
  // ---------------------------------------------------------------------------
  async findById(tenantId: string, id: string): Promise<ContractResponse> {
    const contract = await this.prisma.contract.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: DEFAULT_INCLUDE,
    });
    if (!contract) throw new NotFoundException('Contrato não encontrado');
    return toContractResponse(contract, { includePassword: true });
  }

  async list(tenantId: string, q: ListContractsQuery): Promise<Paginated<ContractResponse>> {
    const where: Prisma.ContractWhereInput = {
      tenantId,
      deletedAt: null,
      ...(q.customerId && { customerId: q.customerId }),
      ...(q.status && { status: q.status }),
      ...(q.pppoeUsername && { pppoeUsername: q.pppoeUsername }),
      ...(q.search && {
        OR: [
          { code: { contains: q.search, mode: 'insensitive' } },
          { pppoeUsername: { contains: q.search, mode: 'insensitive' } },
          { installationAddress: { contains: q.search, mode: 'insensitive' } },
        ],
      }),
    };
    const skip = (q.page - 1) * q.pageSize;
    const [rows, total] = await Promise.all([
      this.prisma.contract.findMany({
        where,
        include: DEFAULT_INCLUDE,
        orderBy: { [q.sortBy]: q.sortDir },
        skip,
        take: q.pageSize,
      }),
      this.prisma.contract.count({ where }),
    ]);
    return {
      data: rows.map((r) => toContractResponse(r, { includePassword: false })),
      pagination: paginationMeta(total, q.page, q.pageSize),
    };
  }

  // ---------------------------------------------------------------------------
  // UPDATE (dados comerciais; não mexe em status)
  // ---------------------------------------------------------------------------
  async update(
    tenantId: string,
    actorUserId: string,
    id: string,
    input: UpdateContractRequest,
  ): Promise<ContractResponse> {
    const existing = await this.prisma.contract.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Contrato não encontrado');

    const data: Prisma.ContractUpdateInput = {
      updatedBy: { connect: { id: actorUserId } },
    };
    if (input.pppoeUsername !== undefined) data.pppoeUsername = input.pppoeUsername;
    if (input.pppoePassword !== undefined) data.pppoePassword = input.pppoePassword;
    if (input.installationAddress !== undefined) data.installationAddress = input.installationAddress;
    if (input.installationMapsUrl !== undefined)
      data.installationMapsUrl = input.installationMapsUrl ?? null;
    if (input.monthlyValue !== undefined) data.monthlyValue = new Prisma.Decimal(input.monthlyValue);
    if (input.bandwidthMbps !== undefined) data.bandwidthMbps = input.bandwidthMbps;
    if (input.dueDay !== undefined) data.dueDay = input.dueDay;
    if (input.notes !== undefined) data.notes = input.notes ?? null;

    const updated = await this.prisma.contract.update({
      where: { id: existing.id },
      data,
      include: DEFAULT_INCLUDE,
    });

    // Se pppoeUsername mudou, enfileira sync no RADIUS para novo usuário
    if (input.pppoeUsername && input.pppoeUsername !== existing.pppoeUsername) {
      await this.radius.enqueueSync(updated, `pppoe alterado: ${existing.pppoeUsername} -> ${updated.pppoeUsername}`);
    }

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'contracts.updated',
      resource: 'contracts',
      resourceId: updated.id,
    });
    return toContractResponse(updated, { includePassword: true });
  }

  // ---------------------------------------------------------------------------
  // TRANSIÇÕES DE ESTADO
  // ---------------------------------------------------------------------------
  async suspend(
    tenantId: string,
    actorUserId: string,
    id: string,
    input: SuspendContractRequest,
  ): Promise<ContractResponse> {
    const reason: ContractSuspendReason = input.reason;
    return this.applySuspend(tenantId, id, reason, { actorUserId, manual: true, note: input.note });
  }

  /**
   * Versão interna usada pelo cron (sem actor humano).
   * Pública porque o OverdueScanService precisa chamá-la.
   */
  async applySuspend(
    tenantId: string,
    id: string,
    reason: ContractSuspendReason,
    opts: { actorUserId?: string; manual?: boolean; note?: string } = {},
  ): Promise<ContractResponse> {
    const existing = await this.prisma.contract.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Contrato não encontrado');
    if (existing.status === PrismaContractStatus.CANCELLED) {
      throw new BadRequestException('Contrato cancelado não pode ser suspenso');
    }
    if (existing.status === PrismaContractStatus.SUSPENDED) {
      return toContractResponse(
        (await this.prisma.contract.findFirstOrThrow({
          where: { id },
          include: DEFAULT_INCLUDE,
        })),
        { includePassword: true },
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const c = await tx.contract.update({
        where: { id: existing.id },
        data: {
          status: PrismaContractStatus.SUSPENDED,
          suspendReason: reason as PrismaSuspendReason,
          suspendedAt: new Date(),
          updatedById: opts.actorUserId ?? null,
        },
        include: DEFAULT_INCLUDE,
      });
      await this.radius.enqueueSync(c, opts.note ?? `suspensão (${reason})`, tx);
      await this.radius.enqueueDisconnect(c, `suspensão (${reason})`, tx);
      return c;
    });

    await this.audit.log({
      tenantId,
      userId: opts.actorUserId ?? null,
      action: 'contracts.suspended',
      resource: 'contracts',
      resourceId: updated.id,
      metadata: { reason, manual: opts.manual ?? false, note: opts.note ?? null },
    });
    return toContractResponse(updated, { includePassword: true });
  }

  async reactivate(
    tenantId: string,
    actorUserId: string,
    id: string,
    input: ReactivateContractRequest,
  ): Promise<ContractResponse> {
    return this.applyReactivate(tenantId, id, { actorUserId, note: input.note });
  }

  async applyReactivate(
    tenantId: string,
    id: string,
    opts: { actorUserId?: string; note?: string } = {},
  ): Promise<ContractResponse> {
    const existing = await this.prisma.contract.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Contrato não encontrado');
    if (existing.status === PrismaContractStatus.CANCELLED) {
      throw new BadRequestException('Contrato cancelado não pode ser reativado');
    }
    if (existing.status === PrismaContractStatus.ACTIVE) {
      return toContractResponse(
        (await this.prisma.contract.findFirstOrThrow({ where: { id }, include: DEFAULT_INCLUDE })),
        { includePassword: true },
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const c = await tx.contract.update({
        where: { id: existing.id },
        data: {
          status: PrismaContractStatus.ACTIVE,
          suspendReason: null,
          suspendedAt: null,
          activatedAt: existing.activatedAt ?? new Date(),
          updatedById: opts.actorUserId ?? null,
        },
        include: DEFAULT_INCLUDE,
      });
      await this.radius.enqueueSync(c, opts.note ?? 'reativação', tx);
      return c;
    });

    await this.audit.log({
      tenantId,
      userId: opts.actorUserId ?? null,
      action: 'contracts.reactivated',
      resource: 'contracts',
      resourceId: updated.id,
      metadata: { note: opts.note ?? null },
    });
    return toContractResponse(updated, { includePassword: true });
  }

  async cancel(
    tenantId: string,
    actorUserId: string,
    id: string,
    input: CancelContractRequest,
  ): Promise<ContractResponse> {
    const existing = await this.prisma.contract.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Contrato não encontrado');
    if (existing.status === PrismaContractStatus.CANCELLED) {
      return toContractResponse(
        (await this.prisma.contract.findFirstOrThrow({ where: { id }, include: DEFAULT_INCLUDE })),
        { includePassword: true },
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const c = await tx.contract.update({
        where: { id: existing.id },
        data: {
          status: PrismaContractStatus.CANCELLED,
          cancelledAt: new Date(),
          updatedById: actorUserId,
        },
        include: DEFAULT_INCLUDE,
      });
      // Cancela todas as faturas abertas
      await tx.contractInvoice.updateMany({
        where: { tenantId, contractId: c.id, status: { in: [InvoiceStatus.OPEN, InvoiceStatus.OVERDUE] } },
        data: { status: InvoiceStatus.CANCELLED },
      });
      await this.radius.enqueueSync(c, input.note ?? 'cancelamento', tx);
      await this.radius.enqueueDisconnect(c, input.note ?? 'cancelamento', tx);
      return c;
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'contracts.cancelled',
      resource: 'contracts',
      resourceId: updated.id,
      metadata: { note: input.note ?? null },
    });
    return toContractResponse(updated, { includePassword: true });
  }

  // ---------------------------------------------------------------------------
  // DELETE (soft)
  // ---------------------------------------------------------------------------
  async remove(tenantId: string, actorUserId: string, id: string): Promise<void> {
    const existing = await this.prisma.contract.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Contrato não encontrado');
    if (existing.status !== PrismaContractStatus.CANCELLED) {
      throw new BadRequestException('Cancele o contrato antes de excluí-lo');
    }
    await this.prisma.contract.update({
      where: { id },
      data: { deletedAt: new Date(), updatedById: actorUserId },
    });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'contracts.deleted',
      resource: 'contracts',
      resourceId: id,
    });
  }
}

// ---------------------------------------------------------------------------
// MAPPER
// ---------------------------------------------------------------------------
function toContractResponse(
  c: ContractWithRelations,
  opts: { includePassword: boolean },
): ContractResponse {
  return {
    id: c.id,
    tenantId: c.tenantId,
    customerId: c.customerId,
    code: c.code,
    pppoeUsername: c.pppoeUsername,
    ...(opts.includePassword ? { pppoePassword: c.pppoePassword } : {}),
    installationAddress: c.installationAddress,
    installationMapsUrl: c.installationMapsUrl,
    monthlyValue: Number(c.monthlyValue),
    bandwidthMbps: c.bandwidthMbps,
    dueDay: c.dueDay,
    status: c.status as ContractStatus,
    suspendReason: (c.suspendReason as ContractSuspendReason | null) ?? null,
    activatedAt: c.activatedAt?.toISOString() ?? null,
    suspendedAt: c.suspendedAt?.toISOString() ?? null,
    cancelledAt: c.cancelledAt?.toISOString() ?? null,
    notes: c.notes,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    customer: c.customer
      ? {
          id: c.customer.id,
          displayName: c.customer.displayName,
          type: c.customer.type as 'INDIVIDUAL' | 'COMPANY',
        }
      : null,
  };
}
