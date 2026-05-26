/**
 * FiberCablesService — CRUD de cabos de fibra (R3 OSP).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Doc de visão: docs/architecture/osp-network.md
 *
 * Geometria: persistida como LineString GeoJSON ([[lng, lat], ...]) no Json
 * do banco, mas API troca como `Array<{latitude, longitude}>` — coerente com
 * o resto do app NetX (LocationPicker, Contract.latitude/longitude).
 *
 * Comprimento: somatório Haversine dos trechos. Operador pode override pra
 * registrar "cabo frouxo" no poste (acréscimo real de 10-15% sobre reta).
 *
 * Sem PostGIS — todas as operações geo ficam no Node. Pra <50k cabos é
 * folgado; vira gargalo se um dia precisar de queries "cabos dentro de bbox".
 */
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  CreateFiberCableRequest,
  FiberCableResponse,
  ListFiberCablesQuery,
  Paginated,
  PathPoint,
  UpdateFiberCableRequest,
} from '@netx/shared';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

// Raio médio da Terra (m). WGS84 elipsoidal seria mais preciso (<0.3% diff
// em distâncias FTTH — 100m de cabo varia <30cm), mas Haversine esférico é
// suficiente pra cálculo de cabo de cliente.
const EARTH_RADIUS_M = 6_371_000;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Distância Haversine em metros entre 2 pontos lat/lng. */
function haversine(a: PathPoint, b: PathPoint): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** Soma Haversine de todos os trechos consecutivos da polyline. */
export function calculatePathLength(path: PathPoint[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    total += haversine(path[i - 1], path[i]);
  }
  return Math.round(total * 100) / 100; // arredonda pra 2 casas
}

/**
 * Banco guarda LineString GeoJSON ([lng, lat]). API troca {lat, lng}.
 * Conversões cirúrgicas pra não vazar GeoJSON pros consumidores.
 */
function pathToGeoJson(path: PathPoint[]): Array<[number, number]> {
  return path.map((p) => [p.longitude, p.latitude]);
}
function pathFromGeoJson(json: unknown): PathPoint[] {
  if (!Array.isArray(json)) return [];
  return json
    .filter(
      (p): p is [number, number] =>
        Array.isArray(p) && typeof p[0] === 'number' && typeof p[1] === 'number',
    )
    .map(([lng, lat]) => ({ latitude: lat, longitude: lng }));
}

type CableRow = Prisma.FiberCableGetPayload<Record<string, never>>;

function toResponse(c: CableRow, overridden: boolean): FiberCableResponse {
  return {
    id: c.id,
    tenantId: c.tenantId,
    code: c.code,
    type: c.type,
    fiberCount: c.fiberCount,
    path: pathFromGeoJson(c.path),
    lengthMeters: Number(c.lengthMeters),
    lengthOverridden: overridden,
    notes: c.notes,
    isActive: c.isActive,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

@Injectable()
export class FiberCablesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ───────────────────────────────────────────────────────────────────────────
  // READ
  // ───────────────────────────────────────────────────────────────────────────
  async list(
    tenantId: string,
    q: ListFiberCablesQuery,
  ): Promise<Paginated<FiberCableResponse>> {
    const where: Prisma.FiberCableWhereInput = {
      tenantId,
      deletedAt: null,
      ...(q.type ? { type: q.type } : {}),
      ...(q.search
        ? { code: { contains: q.search, mode: 'insensitive' } }
        : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.fiberCable.count({ where }),
      this.prisma.fiberCable.findMany({
        where,
        orderBy: { code: 'asc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    // Não temos como saber se foi override sem refazer cálculo — comparamos
    // com Haversine atual; diff >5m considera-se override deliberado.
    return {
      data: rows.map((r) => {
        const computed = calculatePathLength(pathFromGeoJson(r.path));
        const stored = Number(r.lengthMeters);
        const overridden = Math.abs(computed - stored) > 5;
        return toResponse(r, overridden);
      }),
      pagination: {
        page: q.page,
        pageSize: q.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
      },
    };
  }

  async findById(tenantId: string, id: string): Promise<FiberCableResponse> {
    const c = await this.prisma.fiberCable.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!c) throw new NotFoundException('Cabo não encontrado');
    const computed = calculatePathLength(pathFromGeoJson(c.path));
    const overridden = Math.abs(computed - Number(c.lengthMeters)) > 5;
    return toResponse(c, overridden);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // CREATE
  // ───────────────────────────────────────────────────────────────────────────
  async create(
    tenantId: string,
    actorUserId: string,
    input: CreateFiberCableRequest,
  ): Promise<FiberCableResponse> {
    const computed = calculatePathLength(input.path);
    const lengthMeters = input.lengthMetersOverride ?? computed;

    try {
      const created = await this.prisma.fiberCable.create({
        data: {
          tenantId,
          code: input.code.trim(),
          type: input.type,
          fiberCount: input.fiberCount,
          path: pathToGeoJson(input.path) as Prisma.InputJsonValue,
          lengthMeters,
          notes: input.notes ?? null,
          isActive: input.isActive ?? true,
          createdById: actorUserId,
          updatedById: actorUserId,
        },
      });
      await this.audit.log({
        tenantId,
        userId: actorUserId,
        action: 'fiber.cable.created',
        resource: 'fiber_cables',
        resourceId: created.id,
        afterState: {
          code: created.code,
          type: created.type,
          fiberCount: created.fiberCount,
          lengthMeters: Number(created.lengthMeters),
        },
      });
      return this.findById(tenantId, created.id);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException('Já existe cabo com esse código');
      }
      throw err;
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // UPDATE
  // ───────────────────────────────────────────────────────────────────────────
  async update(
    tenantId: string,
    actorUserId: string,
    id: string,
    input: UpdateFiberCableRequest,
  ): Promise<FiberCableResponse> {
    const existing = await this.prisma.fiberCable.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Cabo não encontrado');

    // Se path mudou, recalcula length (override só vale se enviado junto).
    const nextPath = input.path ?? pathFromGeoJson(existing.path);
    const computed = calculatePathLength(nextPath);
    const nextLength =
      input.lengthMetersOverride !== undefined
        ? input.lengthMetersOverride ?? computed
        : input.path
          ? computed
          : Number(existing.lengthMeters);

    try {
      await this.prisma.fiberCable.update({
        where: { id },
        data: {
          code: input.code?.trim(),
          type: input.type,
          fiberCount: input.fiberCount,
          path:
            input.path !== undefined
              ? (pathToGeoJson(input.path) as Prisma.InputJsonValue)
              : undefined,
          lengthMeters: nextLength,
          notes: input.notes === undefined ? undefined : input.notes ?? null,
          isActive: input.isActive,
          updatedById: actorUserId,
        },
      });
      await this.audit.log({
        tenantId,
        userId: actorUserId,
        action: 'fiber.cable.updated',
        resource: 'fiber_cables',
        resourceId: id,
      });
      return this.findById(tenantId, id);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException('Já existe cabo com esse código');
      }
      throw err;
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // DELETE (soft)
  // ───────────────────────────────────────────────────────────────────────────
  async remove(
    tenantId: string,
    actorUserId: string,
    id: string,
  ): Promise<void> {
    const existing = await this.prisma.fiberCable.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Cabo não encontrado');

    await this.prisma.fiberCable.update({
      where: { id },
      data: { deletedAt: new Date(), updatedById: actorUserId },
    });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'fiber.cable.deleted',
      resource: 'fiber_cables',
      resourceId: id,
    });
  }
}
