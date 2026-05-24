import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ServiceOrderStatus as PrismaSOStatus } from '@prisma/client';

import {
  paginationMeta,
  type CancelServiceOrderRequest,
  type CompleteServiceOrderRequest,
  type CreateServiceOrderRequest,
  type ListServiceOrdersQuery,
  type Paginated,
  type ServiceOrderDisplayStatus,
  type ServiceOrderResponse,
  type ServiceOrderStatus,
  type StartServiceOrderRequest,
  type UpdateServiceOrderRequest,
} from '@netx/shared';

import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

/**
 * O.S — Ordens de Serviço.
 *
 * Decisões importantes:
 *
 * 1. Status persistido vs. status derivado.
 *    `OVERDUE` NÃO é gravado no DB. Quando a O.S está SCHEDULED ou OPEN com
 *    `scheduledAt` no passado, o `displayStatus` da resposta vira OVERDUE.
 *    Isso evita rodar um cron de scan e mantém a transição de status
 *    determinística (estado real só muda em ação explícita do usuário).
 *
 * 2. Filtro por OVERDUE no list.
 *    O frontend pode passar `?status=OVERDUE`. O service traduz pra
 *    `scheduledAt < now AND status ∈ {OPEN, SCHEDULED}`.
 *
 * 3. Denormalização de city/state.
 *    Ao criar, se não vier explícito, tenta puxar do endereço primário do
 *    customer do contrato. Indexado pra filtro rápido sem JOIN.
 *
 * 4. Code humano OS-NNNNNN.
 *    Numeração por tenant via tabela `service_orders` (count + 1). Como o seq
 *    é por tenant, conflitos paralelos são raros — cobertos com try/catch +
 *    retry uma vez (P2002).
 */
@Injectable()
export class ServiceOrdersService {
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
    input: CreateServiceOrderRequest,
  ): Promise<ServiceOrderResponse> {
    // Validações de FK
    const contract = await this.prisma.contract.findFirst({
      where: { id: input.contractId, tenantId, deletedAt: null },
      include: {
        customer: {
          include: {
            // Endereço primário pra puxar city/state se vazio.
            addresses: { where: { isPrimary: true }, take: 1 },
          },
        },
      },
    });
    if (!contract) throw new NotFoundException('Contrato não encontrado');

    const reason = await this.prisma.serviceOrderReason.findFirst({
      where: { id: input.reasonId, tenantId, isActive: true },
    });
    if (!reason)
      throw new BadRequestException(
        'Motivo de O.S inválido ou inativo. Cadastre em Configurações.',
      );

    // Denormaliza cidade/estado do customer se o caller não passou.
    const primaryAddr = contract.customer?.addresses?.[0];
    const city = input.city ?? primaryAddr?.city ?? null;
    const state = input.state ?? primaryAddr?.state ?? null;

    // Status inicial: se tem scheduledAt no futuro → SCHEDULED, senão OPEN.
    const scheduled = input.scheduledAt ? new Date(input.scheduledAt) : null;
    const initialStatus: PrismaSOStatus = scheduled
      ? PrismaSOStatus.SCHEDULED
      : PrismaSOStatus.OPEN;

    // Geração de code humano (OS-NNNNNN). Numeração por tenant.
    const code = input.code ?? (await this.nextCode(tenantId));

    let created;
    try {
      created = await this.prisma.serviceOrder.create({
        data: {
          tenantId,
          contractId: input.contractId,
          reasonId: input.reasonId,
          code,
          status: initialStatus,
          scheduledAt: scheduled,
          openDescription: input.openDescription,
          city,
          state,
          assignedToId: input.assignedToId ?? null,
          createdById: actorUserId,
          updatedById: actorUserId,
        },
        include: defaultInclude(),
      });
    } catch (err) {
      // Race condition no code: tenta uma vez mais com novo número.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const retryCode = await this.nextCode(tenantId);
        created = await this.prisma.serviceOrder.create({
          data: {
            tenantId,
            contractId: input.contractId,
            reasonId: input.reasonId,
            code: retryCode,
            status: initialStatus,
            scheduledAt: scheduled,
            openDescription: input.openDescription,
            city,
            state,
            assignedToId: input.assignedToId ?? null,
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
      action: 'service_order.created',
      resource: 'service_orders',
      resourceId: created.id,
      afterState: {
        code: created.code,
        contractId: created.contractId,
        reasonId: created.reasonId,
        status: created.status,
      },
    });
    return toResponse(created);
  }

  // ---------------------------------------------------------------------------
  // LIST
  // ---------------------------------------------------------------------------
  async list(
    tenantId: string,
    q: ListServiceOrdersQuery,
  ): Promise<Paginated<ServiceOrderResponse>> {
    const where: Prisma.ServiceOrderWhereInput = {
      tenantId,
      deletedAt: null,
      ...(q.contractId ? { contractId: q.contractId } : {}),
      ...(q.reasonId ? { reasonId: q.reasonId } : {}),
      ...(q.assignedToId === 'unassigned'
        ? { assignedToId: null }
        : q.assignedToId
          ? { assignedToId: q.assignedToId }
          : {}),
      ...(q.customerId
        ? { contract: { customerId: q.customerId } }
        : {}),
      ...(q.city ? { city: { contains: q.city, mode: 'insensitive' } } : {}),
      ...buildStatusFilter(q.status),
      ...(q.scheduledFrom || q.scheduledTo
        ? {
            scheduledAt: {
              ...(q.scheduledFrom ? { gte: new Date(q.scheduledFrom) } : {}),
              ...(q.scheduledTo ? { lte: new Date(q.scheduledTo) } : {}),
            },
          }
        : {}),
      ...(q.search
        ? {
            OR: [
              { code: { contains: q.search, mode: 'insensitive' } },
              { openDescription: { contains: q.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.serviceOrder.findMany({
        where,
        include: defaultInclude(),
        orderBy: { [q.sortBy]: q.sortDir },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.serviceOrder.count({ where }),
    ]);

    return {
      data: rows.map(toResponse),
      pagination: paginationMeta(total, q.page, q.pageSize),
    };
  }

  async findById(tenantId: string, id: string): Promise<ServiceOrderResponse> {
    const row = await this.prisma.serviceOrder.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: defaultInclude(),
    });
    if (!row) throw new NotFoundException('O.S não encontrada');
    return toResponse(row);
  }

  // ---------------------------------------------------------------------------
  // UPDATE (campos editáveis)
  // ---------------------------------------------------------------------------
  async update(
    tenantId: string,
    actorUserId: string,
    id: string,
    input: UpdateServiceOrderRequest,
  ): Promise<ServiceOrderResponse> {
    const before = await this.prisma.serviceOrder.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!before) throw new NotFoundException('O.S não encontrada');

    if (input.reasonId) {
      const reason = await this.prisma.serviceOrderReason.findFirst({
        where: { id: input.reasonId, tenantId, isActive: true },
      });
      if (!reason)
        throw new BadRequestException('Motivo de O.S inválido ou inativo');
    }

    // Mudou scheduledAt enquanto status estava OPEN? Promove pra SCHEDULED.
    // Tirou o scheduledAt em SCHEDULED? Volta pra OPEN.
    let nextStatus: PrismaSOStatus | undefined;
    if (input.scheduledAt !== undefined) {
      if (input.scheduledAt && before.status === PrismaSOStatus.OPEN) {
        nextStatus = PrismaSOStatus.SCHEDULED;
      } else if (!input.scheduledAt && before.status === PrismaSOStatus.SCHEDULED) {
        nextStatus = PrismaSOStatus.OPEN;
      }
    }

    const updated = await this.prisma.serviceOrder.update({
      where: { id },
      data: {
        reasonId: input.reasonId,
        scheduledAt:
          input.scheduledAt === undefined
            ? undefined
            : input.scheduledAt
              ? new Date(input.scheduledAt)
              : null,
        openDescription: input.openDescription,
        closeDescription:
          input.closeDescription === undefined
            ? undefined
            : input.closeDescription ?? null,
        city: input.city,
        state: input.state,
        assignedToId: input.assignedToId,
        ...(nextStatus ? { status: nextStatus } : {}),
        updatedById: actorUserId,
      },
      include: defaultInclude(),
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'service_order.updated',
      resource: 'service_orders',
      resourceId: id,
      beforeState: { status: before.status, scheduledAt: before.scheduledAt },
      afterState: { status: updated.status, scheduledAt: updated.scheduledAt },
    });

    return toResponse(updated);
  }

  // ---------------------------------------------------------------------------
  // TRANSIÇÕES DE STATUS
  // ---------------------------------------------------------------------------
  async start(
    tenantId: string,
    actorUserId: string,
    id: string,
    input: StartServiceOrderRequest,
  ): Promise<ServiceOrderResponse> {
    const before = await this.prisma.serviceOrder.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!before) throw new NotFoundException('O.S não encontrada');
    if (before.status === PrismaSOStatus.IN_PROGRESS)
      throw new ConflictException('O.S já está em execução');
    if (
      before.status === PrismaSOStatus.COMPLETED ||
      before.status === PrismaSOStatus.CANCELLED
    )
      throw new ConflictException('O.S já encerrada — não pode ser iniciada');

    const startedAt = input.startedAt ? new Date(input.startedAt) : new Date();
    const updated = await this.prisma.serviceOrder.update({
      where: { id },
      data: {
        status: PrismaSOStatus.IN_PROGRESS,
        startedAt,
        updatedById: actorUserId,
      },
      include: defaultInclude(),
    });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'service_order.started',
      resource: 'service_orders',
      resourceId: id,
      beforeState: { status: before.status },
      afterState: { status: updated.status, startedAt: updated.startedAt },
    });
    return toResponse(updated);
  }

  async complete(
    tenantId: string,
    actorUserId: string,
    id: string,
    input: CompleteServiceOrderRequest,
  ): Promise<ServiceOrderResponse> {
    const before = await this.prisma.serviceOrder.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: {
        reason: { select: { isInstallation: true, name: true } },
      },
    });
    if (!before) throw new NotFoundException('O.S não encontrada');
    if (before.status === PrismaSOStatus.COMPLETED)
      throw new ConflictException('O.S já está finalizada');
    if (before.status === PrismaSOStatus.CANCELLED)
      throw new ConflictException('O.S cancelada — reabra antes de finalizar');

    // Trava de segurança: OS de instalação NÃO pode ser fechada sem ter
    // SerialItem ALLOCATED ao contrato. Impede técnico finalizar instalação
    // sem registrar equipamento entregue (comodato).
    if (before.reason?.isInstallation) {
      const allocatedCount = await this.prisma.serialItem.count({
        where: {
          tenantId,
          contractId: before.contractId,
          status: 'ALLOCATED',
        },
      });
      if (allocatedCount === 0) {
        throw new ConflictException(
          `Esta O.S é uma instalação ("${before.reason.name}") e exige pelo menos ` +
            'um equipamento em comodato vinculado ao contrato. Antes de finalizar, ' +
            'vincule um equipamento via aba "Estoque" do contrato ' +
            '(ou via /provisioning/install se for ONT GPON).',
        );
      }
    }

    const completedAt = input.completedAt
      ? new Date(input.completedAt)
      : new Date();
    const updated = await this.prisma.serviceOrder.update({
      where: { id },
      data: {
        status: PrismaSOStatus.COMPLETED,
        completedAt,
        closeDescription: input.closeDescription,
        updatedById: actorUserId,
      },
      include: defaultInclude(),
    });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'service_order.completed',
      resource: 'service_orders',
      resourceId: id,
      beforeState: { status: before.status },
      afterState: { status: updated.status, completedAt: updated.completedAt },
    });
    return toResponse(updated);
  }

  async cancel(
    tenantId: string,
    actorUserId: string,
    id: string,
    input: CancelServiceOrderRequest,
  ): Promise<ServiceOrderResponse> {
    const before = await this.prisma.serviceOrder.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!before) throw new NotFoundException('O.S não encontrada');
    if (before.status === PrismaSOStatus.CANCELLED)
      throw new ConflictException('O.S já está cancelada');
    if (before.status === PrismaSOStatus.COMPLETED)
      throw new ConflictException('O.S finalizada — não pode ser cancelada');

    const updated = await this.prisma.serviceOrder.update({
      where: { id },
      data: {
        status: PrismaSOStatus.CANCELLED,
        cancelledAt: new Date(),
        updatedById: actorUserId,
      },
      include: defaultInclude(),
    });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'service_order.cancelled',
      resource: 'service_orders',
      resourceId: id,
      beforeState: { status: before.status },
      afterState: { status: updated.status, reason: input.reason ?? null },
    });
    return toResponse(updated);
  }

  // ---------------------------------------------------------------------------
  // SOFT DELETE
  // ---------------------------------------------------------------------------
  async remove(tenantId: string, actorUserId: string, id: string): Promise<void> {
    const before = await this.prisma.serviceOrder.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!before) throw new NotFoundException('O.S não encontrada');

    await this.prisma.serviceOrder.update({
      where: { id },
      data: { deletedAt: new Date(), updatedById: actorUserId },
    });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'service_order.deleted',
      resource: 'service_orders',
      resourceId: id,
    });
  }

  // ---------------------------------------------------------------------------
  // PRIVATE HELPERS
  // ---------------------------------------------------------------------------
  private async nextCode(tenantId: string): Promise<string> {
    const count = await this.prisma.serviceOrder.count({ where: { tenantId } });
    const next = count + 1;
    return `OS-${String(next).padStart(6, '0')}`;
  }
}

// =============================================================================
// HELPERS DE QUERY
// =============================================================================
function buildStatusFilter(
  status?: ServiceOrderDisplayStatus,
): Prisma.ServiceOrderWhereInput {
  if (!status) return {};
  if (status === 'OVERDUE') {
    // Derivado: agendamento vencido sem ter saído de OPEN/SCHEDULED.
    return {
      scheduledAt: { lt: new Date() },
      status: { in: [PrismaSOStatus.OPEN, PrismaSOStatus.SCHEDULED] },
    };
  }
  return { status: status as PrismaSOStatus };
}

function defaultInclude() {
  return {
    reason: { select: { id: true, name: true } },
    contract: {
      select: {
        id: true,
        code: true,
        pppoeUsername: true,
        customerId: true,
        customer: { select: { id: true, displayName: true } },
      },
    },
    assignedTo: { select: { id: true, firstName: true, lastName: true } },
  } as const;
}

// =============================================================================
// MAPPER
// =============================================================================
function toResponse(o: any): ServiceOrderResponse {
  // Computa displayStatus: se vencido (scheduled < now e ainda OPEN/SCHEDULED),
  // mostra como OVERDUE. Status persistido fica intacto.
  const persisted = o.status as ServiceOrderStatus;
  const isOverdue =
    o.scheduledAt &&
    o.scheduledAt.getTime() < Date.now() &&
    (persisted === 'OPEN' || persisted === 'SCHEDULED');
  const displayStatus: ServiceOrderDisplayStatus = isOverdue
    ? 'OVERDUE'
    : persisted;

  return {
    id: o.id,
    tenantId: o.tenantId,
    contractId: o.contractId,
    reasonId: o.reasonId,
    code: o.code,
    status: persisted,
    displayStatus,
    openedAt: o.openedAt.toISOString(),
    scheduledAt: o.scheduledAt?.toISOString() ?? null,
    startedAt: o.startedAt?.toISOString() ?? null,
    completedAt: o.completedAt?.toISOString() ?? null,
    cancelledAt: o.cancelledAt?.toISOString() ?? null,
    openDescription: o.openDescription,
    closeDescription: o.closeDescription,
    city: o.city,
    state: o.state,
    assignedToId: o.assignedToId,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
    reason: o.reason
      ? { id: o.reason.id, name: o.reason.name }
      : null,
    contract: o.contract
      ? {
          id: o.contract.id,
          code: o.contract.code,
          pppoeUsername: o.contract.pppoeUsername,
          customerId: o.contract.customerId,
        }
      : null,
    customer: o.contract?.customer
      ? {
          id: o.contract.customer.id,
          displayName: o.contract.customer.displayName,
        }
      : null,
    assignedTo: o.assignedTo
      ? {
          id: o.assignedTo.id,
          firstName: o.assignedTo.firstName,
          lastName: o.assignedTo.lastName,
        }
      : null,
  };
}
