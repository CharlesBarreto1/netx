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
  type CheckinServiceOrderRequest,
  type CompleteFieldRequest,
  type CompleteInstallationRequest,
  type CompleteServiceOrderRequest,
  type CreateServiceOrderRequest,
  type EnRouteServiceOrderRequest,
  type CreateServiceOrderMessageRequest,
  type ListServiceOrdersQuery,
  type Paginated,
  type RegisterServiceOrderAttachmentRequest,
  type ServiceOrderAttachmentPresignRequest,
  type ServiceOrderAttachmentPresignResponse,
  type ServiceOrderAttachmentResponse,
  type ServiceOrderDisplayStatus,
  type ServiceOrderMessageResponse,
  type ServiceOrderPhotoPresignRequest,
  type ServiceOrderPhotoPresignResponse,
  type ServiceOrderResponse,
  type ServiceOrderStatus,
  type StartServiceOrderRequest,
  type UpdateServiceOrderRequest,
} from '@netx/shared';

import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ContractsService } from '../contracts/contracts.service';
import { ProvisioningService } from '../provisioning/provisioning.service';
import { OsConsumptionService } from '../stock/os-consumption.service';
import { StorageService } from '../storage/storage.service';

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
    private readonly provisioning: ProvisioningService,
    private readonly consumption: OsConsumptionService,
    private readonly storage: StorageService,
    private readonly contracts: ContractsService,
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

  // ---------------------------------------------------------------------------
  // LIFECYCLE DE CAMPO (tela /os do técnico)
  // ---------------------------------------------------------------------------
  /** Técnico inicia deslocamento → EN_ROUTE ("a caminho"). */
  async enRoute(
    tenantId: string,
    actorUserId: string,
    id: string,
    input: EnRouteServiceOrderRequest,
  ): Promise<ServiceOrderResponse> {
    const before = await this.prisma.serviceOrder.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!before) throw new NotFoundException('O.S não encontrada');
    if (
      before.status === PrismaSOStatus.COMPLETED ||
      before.status === PrismaSOStatus.CANCELLED
    )
      throw new ConflictException('O.S encerrada — não pode iniciar deslocamento');
    if (before.status === PrismaSOStatus.IN_PROGRESS)
      throw new ConflictException('O.S já está em execução');

    const enRouteAt = input.enRouteAt ? new Date(input.enRouteAt) : new Date();
    const updated = await this.prisma.serviceOrder.update({
      where: { id },
      data: { status: PrismaSOStatus.EN_ROUTE, enRouteAt, updatedById: actorUserId },
      include: defaultInclude(),
    });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'service_order.en_route',
      resource: 'service_orders',
      resourceId: id,
      beforeState: { status: before.status },
      afterState: { status: updated.status, enRouteAt: updated.enRouteAt },
    });
    return toResponse(updated);
  }

  /** Check-in ao chegar no local → IN_PROGRESS (seta checkinAt + startedAt). */
  async checkin(
    tenantId: string,
    actorUserId: string,
    id: string,
    input: CheckinServiceOrderRequest,
  ): Promise<ServiceOrderResponse> {
    const before = await this.prisma.serviceOrder.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!before) throw new NotFoundException('O.S não encontrada');
    if (
      before.status === PrismaSOStatus.COMPLETED ||
      before.status === PrismaSOStatus.CANCELLED
    )
      throw new ConflictException('O.S encerrada — não pode fazer check-in');

    const at = input.checkinAt ? new Date(input.checkinAt) : new Date();
    const updated = await this.prisma.serviceOrder.update({
      where: { id },
      data: {
        status: PrismaSOStatus.IN_PROGRESS,
        checkinAt: at,
        startedAt: before.startedAt ?? at,
        updatedById: actorUserId,
      },
      include: defaultInclude(),
    });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'service_order.checkin',
      resource: 'service_orders',
      resourceId: id,
      beforeState: { status: before.status },
      afterState: { status: updated.status, checkinAt: updated.checkinAt },
    });
    return toResponse(updated);
  }

  /** URL presigned pra o técnico subir uma foto de campo direto no MinIO. */
  async presignPhoto(
    tenantId: string,
    id: string,
    input: ServiceOrderPhotoPresignRequest,
  ): Promise<ServiceOrderPhotoPresignResponse> {
    const so = await this.prisma.serviceOrder.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!so) throw new NotFoundException('O.S não encontrada');
    if (!this.storage.isEnabled())
      throw new BadRequestException('Storage (MinIO) não configurado');
    const key = this.storage.buildKey(
      tenantId,
      `service-orders/${id}/photos`,
      input.fileName,
    );
    const { url, expiresIn } = await this.storage.presignUpload(key, input.contentType);
    return { uploadUrl: url, storageKey: key, expiresIn };
  }

  // ---------------------------------------------------------------------------
  // MENSAGENS — thread atendente ↔ técnico
  // ---------------------------------------------------------------------------
  async listMessages(
    tenantId: string,
    serviceOrderId: string,
  ): Promise<ServiceOrderMessageResponse[]> {
    await this.assertExists(tenantId, serviceOrderId);
    const rows = await this.prisma.serviceOrderMessage.findMany({
      where: { tenantId, serviceOrderId },
      orderBy: { createdAt: 'asc' },
      include: { author: { select: { id: true, firstName: true, lastName: true } } },
    });
    return rows.map((m) => ({
      id: m.id,
      body: m.body,
      createdAt: m.createdAt.toISOString(),
      author: m.author
        ? { id: m.author.id, firstName: m.author.firstName, lastName: m.author.lastName }
        : null,
    }));
  }

  async createMessage(
    tenantId: string,
    actorUserId: string,
    serviceOrderId: string,
    input: CreateServiceOrderMessageRequest,
  ): Promise<ServiceOrderMessageResponse> {
    await this.assertExists(tenantId, serviceOrderId);
    const created = await this.prisma.serviceOrderMessage.create({
      data: {
        tenantId,
        serviceOrderId,
        authorId: actorUserId,
        body: input.body.trim(),
      },
      include: { author: { select: { id: true, firstName: true, lastName: true } } },
    });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'service_order.message_added',
      resource: 'service_orders',
      resourceId: serviceOrderId,
    });
    return {
      id: created.id,
      body: created.body,
      createdAt: created.createdAt.toISOString(),
      author: created.author
        ? {
            id: created.author.id,
            firstName: created.author.firstName,
            lastName: created.author.lastName,
          }
        : null,
    };
  }

  // ---------------------------------------------------------------------------
  // ANEXOS — arquivos avulsos (MinIO presigned), distintos das fotos de campo
  // ---------------------------------------------------------------------------
  async presignAttachment(
    tenantId: string,
    serviceOrderId: string,
    input: ServiceOrderAttachmentPresignRequest,
  ): Promise<ServiceOrderAttachmentPresignResponse> {
    await this.assertExists(tenantId, serviceOrderId);
    if (!this.storage.isEnabled())
      throw new BadRequestException('Storage (MinIO) não configurado');
    const key = this.storage.buildKey(
      tenantId,
      `service-orders/${serviceOrderId}/attachments`,
      input.fileName,
    );
    const { url, expiresIn } = await this.storage.presignUpload(key, input.contentType);
    return { uploadUrl: url, storageKey: key, expiresIn };
  }

  async registerAttachment(
    tenantId: string,
    actorUserId: string,
    serviceOrderId: string,
    input: RegisterServiceOrderAttachmentRequest,
  ): Promise<ServiceOrderAttachmentResponse> {
    await this.assertExists(tenantId, serviceOrderId);
    const created = await this.prisma.serviceOrderAttachment.create({
      data: {
        tenantId,
        serviceOrderId,
        storageKey: input.storageKey,
        fileName: input.fileName,
        contentType: input.contentType ?? null,
        sizeBytes: input.sizeBytes ?? null,
        createdById: actorUserId,
      },
      include: { createdBy: { select: { id: true, firstName: true, lastName: true } } },
    });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'service_order.attachment_added',
      resource: 'service_orders',
      resourceId: serviceOrderId,
      afterState: { fileName: input.fileName },
    });
    return this.toAttachmentResponse(created);
  }

  async listAttachments(
    tenantId: string,
    serviceOrderId: string,
  ): Promise<ServiceOrderAttachmentResponse[]> {
    await this.assertExists(tenantId, serviceOrderId);
    const rows = await this.prisma.serviceOrderAttachment.findMany({
      where: { tenantId, serviceOrderId },
      orderBy: { createdAt: 'desc' },
      include: { createdBy: { select: { id: true, firstName: true, lastName: true } } },
    });
    return Promise.all(rows.map((r) => this.toAttachmentResponse(r, true)));
  }

  async deleteAttachment(
    tenantId: string,
    actorUserId: string,
    serviceOrderId: string,
    attachmentId: string,
  ): Promise<void> {
    const att = await this.prisma.serviceOrderAttachment.findFirst({
      where: { id: attachmentId, serviceOrderId, tenantId },
    });
    if (!att) throw new NotFoundException('Anexo não encontrado');
    if (this.storage.isEnabled()) {
      try {
        await this.storage.deleteObject(att.storageKey);
      } catch {
        // best-effort: se o objeto já não existe no bucket, segue removendo o registro
      }
    }
    await this.prisma.serviceOrderAttachment.delete({ where: { id: attachmentId } });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'service_order.attachment_removed',
      resource: 'service_orders',
      resourceId: serviceOrderId,
      beforeState: { fileName: att.fileName },
    });
  }

  private async toAttachmentResponse(
    row: {
      id: string;
      fileName: string;
      contentType: string | null;
      sizeBytes: number | null;
      createdAt: Date;
      storageKey: string;
      createdBy?: { id: string; firstName: string; lastName: string } | null;
    },
    withUrl = false,
  ): Promise<ServiceOrderAttachmentResponse> {
    let url: string | undefined;
    if (withUrl && this.storage.isEnabled()) {
      try {
        const signed = await this.storage.presignDownload(row.storageKey, row.fileName);
        url = signed.url;
      } catch {
        // deixa sem url — UI mostra o anexo sem link clicável
      }
    }
    return {
      id: row.id,
      fileName: row.fileName,
      contentType: row.contentType,
      sizeBytes: row.sizeBytes,
      createdAt: row.createdAt.toISOString(),
      createdBy: row.createdBy ?? null,
      url,
    };
  }

  /** Garante que a O.S existe no tenant (lança 404 senão). */
  private async assertExists(tenantId: string, serviceOrderId: string): Promise<void> {
    const so = await this.prisma.serviceOrder.findFirst({
      where: { id: serviceOrderId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!so) throw new NotFoundException('O.S não encontrada');
  }

  /**
   * ONE-TOUCH — finaliza a instalação em campo numa tacada só:
   *   1. Provisiona + ativa contrato + RADIUS + TR-069 + comodato da ONT +
   *      Ufinet (reusa ProvisioningService.installCustomer — parte crítica).
   *   2. Movimenta estoque: materiais consumíveis (cabo/conector/fusão).
   *   3. Anexa fotos (keys já enviadas ao MinIO).
   *   4. Fecha a O.S (closeDescription).
   * Se o provisionamento falhar, aborta ANTES de consumir material/fechar.
   * Obs.: passos 2–4 não são idempotentes — em retry após sucesso do install,
   * cuidado pra não reenviar materiais já consumidos.
   */
  async completeInstallation(
    tenantId: string,
    actorUserId: string,
    id: string,
    input: CompleteInstallationRequest,
    opts: { isAdmin?: boolean } = {},
  ): Promise<{
    serviceOrder: ServiceOrderResponse;
    install: Awaited<ReturnType<ProvisioningService['installCustomer']>>;
  }> {
    const so = await this.prisma.serviceOrder.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true, contractId: true, status: true },
    });
    if (!so) throw new NotFoundException('O.S não encontrada');
    if (so.status === PrismaSOStatus.COMPLETED)
      throw new ConflictException('O.S já finalizada');
    if (so.status === PrismaSOStatus.CANCELLED)
      throw new ConflictException('O.S cancelada — reabra antes de finalizar');

    // 1. Provisiona + ativa contrato (irreversível). Aborta se falhar.
    const install = await this.provisioning.installCustomer(
      tenantId,
      actorUserId,
      so.contractId,
      input.install,
    );
    if (install.status === 'FAILED') {
      throw new ConflictException(
        'Provisionamento falhou — O.S não finalizada. Verifique OLT/ONT e tente novamente.',
      );
    }

    // 2. Materiais consumíveis.
    if (input.materials.length > 0) {
      await this.consumption.addConsumption(
        tenantId,
        actorUserId,
        {
          serviceOrderId: id,
          items: input.materials.map((m) => ({
            productId: m.productId,
            locationId: m.locationId,
            quantity: m.quantity,
            notes: m.notes ?? undefined,
          })),
        },
        { isAdmin: opts.isAdmin },
      );
    }

    // 3. Fotos de comprovação.
    if (input.photos.length > 0) {
      await this.prisma.serviceOrderPhoto.createMany({
        data: input.photos.map((p) => ({
          tenantId,
          serviceOrderId: id,
          storageKey: p.storageKey,
          contentType: p.contentType ?? null,
          sizeBytes: p.sizeBytes ?? null,
          caption: p.caption ?? null,
          createdById: actorUserId,
        })),
      });
    }

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'service_order.field_install',
      resource: 'service_orders',
      resourceId: id,
      metadata: {
        contractId: so.contractId,
        installStatus: install.status,
        materials: input.materials.length,
        photos: input.photos.length,
        enclosureId: input.enclosureId ?? null,
        enclosurePort: input.enclosurePort ?? null,
      },
    });

    // 4. Fecha a O.S (a trava de instalação passa: install alocou a ONT em comodato).
    const serviceOrder = await this.complete(tenantId, actorUserId, id, {
      closeDescription: input.closeDescription,
      completedAt: input.completedAt,
    });

    return { serviceOrder, install };
  }

  /**
   * Finalização de campo ramificada por tipo de O.S (a tela /os monta `mode`
   * a partir de reason.kind + "trocou ONT?"):
   *   INSTALLATION → provisiona tudo (one-touch).
   *   SUPPORT      → fecha + materiais opcionais + fotos (sem provisionar).
   *   SUPPORT_SWAP → troca de ONT (devolve antiga, provisiona nova) + fecha.
   *   RETRIEVAL    → recolhe equipamento + desprovisiona + cancela contrato.
   */
  async completeField(
    tenantId: string,
    actorUserId: string,
    id: string,
    input: CompleteFieldRequest,
    opts: { isAdmin?: boolean } = {},
  ): Promise<{ serviceOrder: ServiceOrderResponse }> {
    const so = await this.prisma.serviceOrder.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true, contractId: true, status: true },
    });
    if (!so) throw new NotFoundException('O.S não encontrada');
    if (so.status === PrismaSOStatus.COMPLETED)
      throw new ConflictException('O.S já finalizada');
    if (so.status === PrismaSOStatus.CANCELLED)
      throw new ConflictException('O.S cancelada — reabra antes de finalizar');

    switch (input.mode) {
      case 'INSTALLATION': {
        const install = await this.provisioning.installCustomer(
          tenantId,
          actorUserId,
          so.contractId,
          input.install,
        );
        if (install.status === 'FAILED')
          throw new ConflictException('Provisionamento falhou — O.S não finalizada.');
        await this.consumeMaterials(tenantId, actorUserId, id, input.materials, opts.isAdmin);
        break;
      }
      case 'SUPPORT':
        await this.consumeMaterials(tenantId, actorUserId, id, input.materials, opts.isAdmin);
        break;
      case 'SUPPORT_SWAP': {
        const r = await this.provisioning.swapOnt(
          tenantId,
          actorUserId,
          so.contractId,
          input.swap,
        );
        if (r.status === 'FAILED')
          throw new ConflictException('Troca de ONT falhou — O.S não finalizada.');
        await this.consumeMaterials(tenantId, actorUserId, id, input.materials, opts.isAdmin);
        break;
      }
      case 'RETRIEVAL':
        await this.provisioning.deprovision(tenantId, actorUserId, so.contractId, {
          returnLocationId: input.returnLocationId,
        });
        await this.contracts.cancel(tenantId, actorUserId, so.contractId, {
          note: input.cancelReason ?? 'Retirada de equipamento (O.S)',
        });
        break;
    }

    await this.savePhotos(tenantId, actorUserId, id, input.photos);
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'service_order.field_complete',
      resource: 'service_orders',
      resourceId: id,
      metadata: { mode: input.mode, contractId: so.contractId },
    });

    const serviceOrder = await this.complete(tenantId, actorUserId, id, {
      closeDescription: input.closeDescription,
      completedAt: input.completedAt,
    });
    return { serviceOrder };
  }

  private async consumeMaterials(
    tenantId: string,
    actorUserId: string,
    serviceOrderId: string,
    materials: { productId: string; locationId: string; quantity: number; notes?: string | null }[],
    isAdmin?: boolean,
  ): Promise<void> {
    if (!materials.length) return;
    await this.consumption.addConsumption(
      tenantId,
      actorUserId,
      {
        serviceOrderId,
        items: materials.map((m) => ({
          productId: m.productId,
          locationId: m.locationId,
          quantity: m.quantity,
          notes: m.notes ?? undefined,
        })),
      },
      { isAdmin },
    );
  }

  private async savePhotos(
    tenantId: string,
    actorUserId: string,
    serviceOrderId: string,
    photos: {
      storageKey: string;
      contentType?: string | null;
      sizeBytes?: number | null;
      caption?: string | null;
    }[],
  ): Promise<void> {
    if (!photos.length) return;
    await this.prisma.serviceOrderPhoto.createMany({
      data: photos.map((p) => ({
        tenantId,
        serviceOrderId,
        storageKey: p.storageKey,
        contentType: p.contentType ?? null,
        sizeBytes: p.sizeBytes ?? null,
        caption: p.caption ?? null,
        createdById: actorUserId,
      })),
    });
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
    reason: { select: { id: true, name: true, kind: true } },
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
    enRouteAt: o.enRouteAt?.toISOString() ?? null,
    checkinAt: o.checkinAt?.toISOString() ?? null,
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
      ? { id: o.reason.id, name: o.reason.name, kind: o.reason.kind ?? 'SUPPORT' }
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
