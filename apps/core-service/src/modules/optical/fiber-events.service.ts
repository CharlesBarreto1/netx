/**
 * FiberEventsService — eventos OTDR (R6 OSP).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Doc: docs/architecture/osp-network.md
 *
 * Cálculo de localização: dado o path do cabo (LineString lat/lng) e uma
 * distância em metros desde a origem, caminha pelos segments somando
 * Haversine até atingir a distância pedida. Interpola o ponto final.
 *
 * Sem PostGIS, sem @turf/along — implementação inline ~15 linhas, mesma
 * acurácia pra dezenas de km que é o uso real.
 */
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  CreateFiberEventRequest,
  FiberEventResponse,
  ListFiberEventsQuery,
  Paginated,
  ResolveFiberEventRequest,
  UpdateFiberEventRequest,
} from '@netx/shared';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

const EARTH_RADIUS_M = 6_371_000;

interface LL {
  latitude: number;
  longitude: number;
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function haversine(a: LL, b: LL): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/**
 * Interpola linearmente entre 2 pontos lat/lng. Pra dezenas/centenas de
 * metros é suficiente — em escalas continentais usaria geodésica.
 */
function interpolate(a: LL, b: LL, t: number): LL {
  return {
    latitude: a.latitude + (b.latitude - a.latitude) * t,
    longitude: a.longitude + (b.longitude - a.longitude) * t,
  };
}

/**
 * Caminha pela polyline e retorna o ponto exato a `distanceMeters` da origem.
 * Se distância maior que comprimento total, retorna o último vértice.
 *
 * Exportado pra que R5 (power budget v2) e R7 (árvore PON) reusem.
 */
export function pointAlongPath(path: LL[], distanceMeters: number): LL | null {
  if (path.length < 2) return null;
  if (distanceMeters <= 0) return path[0];

  let traversed = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const segLen = haversine(a, b);
    if (traversed + segLen >= distanceMeters) {
      const remaining = distanceMeters - traversed;
      const t = segLen === 0 ? 0 : remaining / segLen;
      return interpolate(a, b, t);
    }
    traversed += segLen;
  }
  // Excedeu o comprimento — retorna o último vértice.
  return path[path.length - 1];
}

type EventRow = Prisma.FiberEventGetPayload<{
  include: {
    cable: { select: { id: true; code: true; lengthMeters: true } };
    reportedBy: { select: { firstName: true; lastName: true } };
    resolvedBy: { select: { firstName: true; lastName: true } };
  };
}>;

function toResponse(e: EventRow): FiberEventResponse {
  return {
    id: e.id,
    tenantId: e.tenantId,
    cableId: e.cableId,
    cable: {
      id: e.cable.id,
      code: e.cable.code,
      lengthMeters: Number(e.cable.lengthMeters),
    },
    distanceMeters: Number(e.distanceMeters),
    fiberIndex: e.fiberIndex,
    latitude: Number(e.latitude),
    longitude: Number(e.longitude),
    type: e.type,
    lossDb: e.lossDb != null ? Number(e.lossDb) : null,
    reportedAt: e.reportedAt.toISOString(),
    reportedById: e.reportedById,
    reportedBy: e.reportedBy
      ? { firstName: e.reportedBy.firstName, lastName: e.reportedBy.lastName }
      : null,
    resolvedAt: e.resolvedAt?.toISOString() ?? null,
    resolvedById: e.resolvedById,
    resolvedBy: e.resolvedBy
      ? { firstName: e.resolvedBy.firstName, lastName: e.resolvedBy.lastName }
      : null,
    isActive: e.resolvedAt == null,
    photoUrl: e.photoUrl,
    notes: e.notes,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
  };
}

const EVENT_INCLUDE = {
  cable: { select: { id: true, code: true, lengthMeters: true } },
  reportedBy: { select: { firstName: true, lastName: true } },
  resolvedBy: { select: { firstName: true, lastName: true } },
} satisfies Prisma.FiberEventInclude;

function parsePath(json: unknown): LL[] {
  if (!Array.isArray(json)) return [];
  return json
    .filter(
      (p): p is [number, number] =>
        Array.isArray(p) &&
        typeof p[0] === 'number' &&
        typeof p[1] === 'number',
    )
    .map(([lng, lat]) => ({ latitude: lat, longitude: lng }));
}

@Injectable()
export class FiberEventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    tenantId: string,
    q: ListFiberEventsQuery,
  ): Promise<Paginated<FiberEventResponse>> {
    const where: Prisma.FiberEventWhereInput = {
      tenantId,
      deletedAt: null,
      ...(q.cableId ? { cableId: q.cableId } : {}),
      ...(q.type ? { type: q.type } : {}),
      ...(q.status === 'active'
        ? { resolvedAt: null }
        : q.status === 'resolved'
          ? { resolvedAt: { not: null } }
          : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.fiberEvent.count({ where }),
      this.prisma.fiberEvent.findMany({
        where,
        include: EVENT_INCLUDE,
        orderBy: { reportedAt: 'desc' },
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

  async findById(
    tenantId: string,
    id: string,
  ): Promise<FiberEventResponse> {
    const e = await this.prisma.fiberEvent.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: EVENT_INCLUDE,
    });
    if (!e) throw new NotFoundException('Evento não encontrado');
    return toResponse(e);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // CREATE
  // ───────────────────────────────────────────────────────────────────────────
  async create(
    tenantId: string,
    actorUserId: string,
    input: CreateFiberEventRequest,
  ): Promise<FiberEventResponse> {
    const cable = await this.prisma.fiberCable.findFirst({
      where: { id: input.cableId, tenantId, deletedAt: null },
      select: { id: true, path: true, lengthMeters: true, fiberCount: true },
    });
    if (!cable) throw new BadRequestException('Cabo inválido');
    if (input.distanceMeters > Number(cable.lengthMeters)) {
      throw new BadRequestException(
        `Distância ${input.distanceMeters} m maior que o comprimento do cabo (${cable.lengthMeters} m). Confira a leitura do OTDR.`,
      );
    }
    if (input.fiberIndex != null && input.fiberIndex > cable.fiberCount) {
      throw new BadRequestException(
        `Fibra ${input.fiberIndex} > capacidade do cabo (${cable.fiberCount}).`,
      );
    }

    const path = parsePath(cable.path);
    const point = pointAlongPath(path, input.distanceMeters);
    if (!point) {
      throw new BadRequestException(
        'Path do cabo inválido — sem ao menos 2 pontos.',
      );
    }

    const created = await this.prisma.fiberEvent.create({
      data: {
        tenantId,
        cableId: input.cableId,
        distanceMeters: input.distanceMeters,
        fiberIndex: input.fiberIndex ?? null,
        latitude: point.latitude,
        longitude: point.longitude,
        type: input.type,
        lossDb: input.lossDb ?? null,
        reportedAt: input.reportedAt ? new Date(input.reportedAt) : new Date(),
        reportedById: actorUserId,
        photoUrl: input.photoUrl ?? null,
        notes: input.notes ?? null,
      },
      include: EVENT_INCLUDE,
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'fiber.event.created',
      resource: 'fiber_events',
      resourceId: created.id,
      afterState: {
        cableId: input.cableId,
        type: input.type,
        distanceMeters: input.distanceMeters,
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
    input: UpdateFiberEventRequest,
  ): Promise<FiberEventResponse> {
    const existing = await this.prisma.fiberEvent.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: { cable: { select: { path: true, lengthMeters: true } } },
    });
    if (!existing) throw new NotFoundException('Evento não encontrado');

    // Recalcula lat/lng se distância mudou.
    let nextLat = Number(existing.latitude);
    let nextLng = Number(existing.longitude);
    if (
      input.distanceMeters !== undefined &&
      input.distanceMeters !== Number(existing.distanceMeters)
    ) {
      if (input.distanceMeters > Number(existing.cable.lengthMeters)) {
        throw new BadRequestException(
          `Distância maior que o comprimento do cabo (${existing.cable.lengthMeters} m).`,
        );
      }
      const path = parsePath(existing.cable.path);
      const point = pointAlongPath(path, input.distanceMeters);
      if (!point) throw new BadRequestException('Path do cabo inválido.');
      nextLat = point.latitude;
      nextLng = point.longitude;
    }

    const updated = await this.prisma.fiberEvent.update({
      where: { id },
      data: {
        distanceMeters: input.distanceMeters,
        fiberIndex:
          input.fiberIndex === undefined ? undefined : input.fiberIndex ?? null,
        latitude: nextLat,
        longitude: nextLng,
        type: input.type,
        lossDb: input.lossDb === undefined ? undefined : input.lossDb ?? null,
        photoUrl:
          input.photoUrl === undefined ? undefined : input.photoUrl ?? null,
        notes: input.notes === undefined ? undefined : input.notes ?? null,
      },
      include: EVENT_INCLUDE,
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'fiber.event.updated',
      resource: 'fiber_events',
      resourceId: id,
    });

    return toResponse(updated);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // RESOLVE (action)
  // ───────────────────────────────────────────────────────────────────────────
  async resolve(
    tenantId: string,
    actorUserId: string,
    id: string,
    input: ResolveFiberEventRequest,
  ): Promise<FiberEventResponse> {
    const existing = await this.prisma.fiberEvent.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Evento não encontrado');
    if (existing.resolvedAt) {
      throw new BadRequestException('Evento já está resolvido');
    }

    const updated = await this.prisma.fiberEvent.update({
      where: { id },
      data: {
        resolvedAt: new Date(),
        resolvedById: actorUserId,
        notes: input.notes
          ? `${existing.notes ? existing.notes + '\n\n' : ''}[Resolvido] ${input.notes}`
          : existing.notes,
      },
      include: EVENT_INCLUDE,
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'fiber.event.resolved',
      resource: 'fiber_events',
      resourceId: id,
    });

    return toResponse(updated);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // REOPEN (limpa resolvedAt)
  // ───────────────────────────────────────────────────────────────────────────
  async reopen(
    tenantId: string,
    actorUserId: string,
    id: string,
  ): Promise<FiberEventResponse> {
    const existing = await this.prisma.fiberEvent.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Evento não encontrado');

    const updated = await this.prisma.fiberEvent.update({
      where: { id },
      data: { resolvedAt: null, resolvedById: null },
      include: EVENT_INCLUDE,
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'fiber.event.reopened',
      resource: 'fiber_events',
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
    const existing = await this.prisma.fiberEvent.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Evento não encontrado');

    await this.prisma.fiberEvent.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'fiber.event.deleted',
      resource: 'fiber_events',
      resourceId: id,
    });
  }
}
