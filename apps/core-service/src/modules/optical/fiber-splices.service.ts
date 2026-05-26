/**
 * FiberSplicesService — fusões/emendas ópticas (R4 OSP).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Doc: docs/architecture/osp-network.md
 *
 * Validações:
 *   1. Cada fibra (cableId, fiberIndex) só vale referência válida — fiberIndex
 *      ≤ cable.fiberCount.
 *   2. Banco rejeita fusão de fibra com ela mesma (CHECK constraint).
 *   3. Service avisa (warning soft no log) quando uma fibra aparece em mais
 *      de 2 splices ativas — anomalia operacional, não bloqueia.
 *   4. Cabo só pode ser deletado se zero splices ativas referenciam (FK Restrict).
 *
 * Output enriquecido: backend já traz `cableA`/`cableB` (code, type, fiberCount)
 * e `fiberAColor`/`fiberBColor` (TIA-598) — evita roundtrip extra na UI.
 *
 * Pré-requisito de R5 (power budget faz traversal cableId → splice → cableId).
 */
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  classifyLoss,
  fiberColor,
  type CreateFiberSpliceRequest,
  type FiberSpliceResponse,
  type ListFiberSplicesQuery,
  type Paginated,
  type UpdateFiberSpliceRequest,
} from '@netx/shared';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

type SpliceRow = Prisma.FiberSpliceGetPayload<{
  include: {
    cableA: { select: { id: true; code: true; type: true; fiberCount: true } };
    cableB: { select: { id: true; code: true; type: true; fiberCount: true } };
    measuredBy: { select: { firstName: true; lastName: true } };
  };
}>;

function toResponse(s: SpliceRow): FiberSpliceResponse {
  const lossDb = s.lossDb != null ? Number(s.lossDb) : null;
  return {
    id: s.id,
    tenantId: s.tenantId,
    latitude: Number(s.latitude),
    longitude: Number(s.longitude),
    cableAId: s.cableAId,
    fiberAIndex: s.fiberAIndex,
    fiberAColor: fiberColor(s.fiberAIndex),
    cableA: s.cableA,
    cableBId: s.cableBId,
    fiberBIndex: s.fiberBIndex,
    fiberBColor: fiberColor(s.fiberBIndex),
    cableB: s.cableB,
    lossDb,
    lossClass: classifyLoss(lossDb),
    photoUrl: s.photoUrl,
    measuredAt: s.measuredAt?.toISOString() ?? null,
    measuredById: s.measuredById,
    measuredBy: s.measuredBy
      ? { firstName: s.measuredBy.firstName, lastName: s.measuredBy.lastName }
      : null,
    notes: s.notes,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

const SPLICE_INCLUDE = {
  cableA: { select: { id: true, code: true, type: true, fiberCount: true } },
  cableB: { select: { id: true, code: true, type: true, fiberCount: true } },
  measuredBy: { select: { firstName: true, lastName: true } },
} satisfies Prisma.FiberSpliceInclude;

@Injectable()
export class FiberSplicesService {
  private readonly logger = new Logger(FiberSplicesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ───────────────────────────────────────────────────────────────────────────
  // READ
  // ───────────────────────────────────────────────────────────────────────────
  async list(
    tenantId: string,
    q: ListFiberSplicesQuery,
  ): Promise<Paginated<FiberSpliceResponse>> {
    const where: Prisma.FiberSpliceWhereInput = {
      tenantId,
      deletedAt: null,
      ...(q.cableId
        ? { OR: [{ cableAId: q.cableId }, { cableBId: q.cableId }] }
        : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.fiberSplice.count({ where }),
      this.prisma.fiberSplice.findMany({
        where,
        include: SPLICE_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    return {
      data: rows.map(toResponse),
      pagination: {
        page: q.page,
        pageSize: q.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
      },
    };
  }

  async findById(tenantId: string, id: string): Promise<FiberSpliceResponse> {
    const s = await this.prisma.fiberSplice.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: SPLICE_INCLUDE,
    });
    if (!s) throw new NotFoundException('Fusão não encontrada');
    return toResponse(s);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // VALIDAÇÃO compartilhada (create + update)
  // ───────────────────────────────────────────────────────────────────────────
  private async validateCablesAndFibers(
    tenantId: string,
    cableAId: string,
    fiberAIndex: number,
    cableBId: string,
    fiberBIndex: number,
  ): Promise<void> {
    const ids = cableAId === cableBId ? [cableAId] : [cableAId, cableBId];
    const cables = await this.prisma.fiberCable.findMany({
      where: { tenantId, id: { in: ids }, deletedAt: null },
      select: { id: true, code: true, fiberCount: true },
    });
    const byId = new Map(cables.map((c) => [c.id, c]));
    const cableA = byId.get(cableAId);
    const cableB = byId.get(cableBId);
    if (!cableA) throw new BadRequestException('Cabo A inválido ou apagado');
    if (!cableB) throw new BadRequestException('Cabo B inválido ou apagado');
    if (fiberAIndex > cableA.fiberCount) {
      throw new BadRequestException(
        `Fibra ${fiberAIndex} > capacidade do cabo ${cableA.code} (${cableA.fiberCount})`,
      );
    }
    if (fiberBIndex > cableB.fiberCount) {
      throw new BadRequestException(
        `Fibra ${fiberBIndex} > capacidade do cabo ${cableB.code} (${cableB.fiberCount})`,
      );
    }
  }

  /**
   * Soft warning quando uma fibra aparece em >2 splices ativas. Não bloqueia
   * porque há cenários legítimos (anel de proteção, multi-drop em pigtail).
   */
  private async warnIfOverbusyFiber(
    tenantId: string,
    cableId: string,
    fiberIndex: number,
    excludeSpliceId?: string,
  ): Promise<void> {
    const count = await this.prisma.fiberSplice.count({
      where: {
        tenantId,
        deletedAt: null,
        ...(excludeSpliceId ? { id: { not: excludeSpliceId } } : {}),
        OR: [
          { cableAId: cableId, fiberAIndex: fiberIndex },
          { cableBId: cableId, fiberBIndex: fiberIndex },
        ],
      },
    });
    if (count >= 2) {
      this.logger.warn(
        `[FiberSplice] fibra ${fiberIndex} do cabo ${cableId} já aparece em ${count + 1} splices ativas — verifique se está correto`,
      );
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // CREATE
  // ───────────────────────────────────────────────────────────────────────────
  async create(
    tenantId: string,
    actorUserId: string,
    input: CreateFiberSpliceRequest,
  ): Promise<FiberSpliceResponse> {
    await this.validateCablesAndFibers(
      tenantId,
      input.cableAId,
      input.fiberAIndex,
      input.cableBId,
      input.fiberBIndex,
    );

    const created = await this.prisma.fiberSplice.create({
      data: {
        tenantId,
        latitude: input.latitude,
        longitude: input.longitude,
        cableAId: input.cableAId,
        fiberAIndex: input.fiberAIndex,
        cableBId: input.cableBId,
        fiberBIndex: input.fiberBIndex,
        lossDb: input.lossDb ?? null,
        photoUrl: input.photoUrl ?? null,
        measuredAt: input.measuredAt ? new Date(input.measuredAt) : null,
        measuredById:
          input.measuredAt && !input.lossDb ? null : actorUserId,
        notes: input.notes ?? null,
        createdById: actorUserId,
        updatedById: actorUserId,
      },
      include: SPLICE_INCLUDE,
    });

    // Soft warnings nos 2 lados — não bloqueia.
    void this.warnIfOverbusyFiber(
      tenantId,
      input.cableAId,
      input.fiberAIndex,
      created.id,
    );
    void this.warnIfOverbusyFiber(
      tenantId,
      input.cableBId,
      input.fiberBIndex,
      created.id,
    );

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'fiber.splice.created',
      resource: 'fiber_splices',
      resourceId: created.id,
      afterState: {
        cableAId: input.cableAId,
        fiberAIndex: input.fiberAIndex,
        cableBId: input.cableBId,
        fiberBIndex: input.fiberBIndex,
        lossDb: input.lossDb,
      },
    });

    return toResponse(created);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // UPDATE
  // ───────────────────────────────────────────────────────────────────────────
  async update(
    tenantId: string,
    actorUserId: string,
    id: string,
    input: UpdateFiberSpliceRequest,
  ): Promise<FiberSpliceResponse> {
    const existing = await this.prisma.fiberSplice.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Fusão não encontrada');

    const nextCableA = input.cableAId ?? existing.cableAId;
    const nextFiberA = input.fiberAIndex ?? existing.fiberAIndex;
    const nextCableB = input.cableBId ?? existing.cableBId;
    const nextFiberB = input.fiberBIndex ?? existing.fiberBIndex;

    if (nextCableA === nextCableB && nextFiberA === nextFiberB) {
      throw new BadRequestException(
        'Fibra não pode ser fundida com ela mesma',
      );
    }

    await this.validateCablesAndFibers(
      tenantId,
      nextCableA,
      nextFiberA,
      nextCableB,
      nextFiberB,
    );

    const updated = await this.prisma.fiberSplice.update({
      where: { id },
      data: {
        latitude: input.latitude,
        longitude: input.longitude,
        cableAId: input.cableAId,
        fiberAIndex: input.fiberAIndex,
        cableBId: input.cableBId,
        fiberBIndex: input.fiberBIndex,
        lossDb: input.lossDb === undefined ? undefined : input.lossDb ?? null,
        photoUrl:
          input.photoUrl === undefined ? undefined : input.photoUrl ?? null,
        measuredAt:
          input.measuredAt === undefined
            ? undefined
            : input.measuredAt
              ? new Date(input.measuredAt)
              : null,
        // Toda vez que o operador altera a medida, registra quem fez.
        measuredById:
          input.lossDb !== undefined || input.measuredAt !== undefined
            ? actorUserId
            : undefined,
        notes: input.notes === undefined ? undefined : input.notes ?? null,
        updatedById: actorUserId,
      },
      include: SPLICE_INCLUDE,
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'fiber.splice.updated',
      resource: 'fiber_splices',
      resourceId: id,
    });

    return toResponse(updated);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // DELETE (soft)
  // ───────────────────────────────────────────────────────────────────────────
  async remove(
    tenantId: string,
    actorUserId: string,
    id: string,
  ): Promise<void> {
    const existing = await this.prisma.fiberSplice.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Fusão não encontrada');

    await this.prisma.fiberSplice.update({
      where: { id },
      data: { deletedAt: new Date(), updatedById: actorUserId },
    });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'fiber.splice.deleted',
      resource: 'fiber_splices',
      resourceId: id,
    });
  }
}
