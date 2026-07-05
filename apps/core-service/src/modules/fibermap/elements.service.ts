/**
 * FibermapElementsService — elementos físicos no mapa (spec §3.3, §6, §14).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Leitura de mapa é SEMPRE por bbox (ST_Intersects + GiST via $queryRaw — o
 * client Prisma não enxerga a coluna geom). Mutações validam pasta/produto e
 * a exclusão exige o elemento "solto" (sem cabos/devices/cortes/conexões —
 * cascata explícita fica pra quem chamou, spec §14.2).
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  CreateFibermapElementRequest,
  FibermapElementFeature,
  FibermapElementResponse,
  FibermapElementSearchHit,
  FibermapElementsFeatureCollection,
  FibermapElementType,
  FibermapProductType,
  ListFibermapElementsQuery,
  SearchFibermapElementsQuery,
  UpdateFibermapElementRequest,
} from '@netx/shared';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

/** Tipo de produto exigido por tipo de elemento (quando productId é dado). */
const PRODUCT_TYPE_BY_ELEMENT: Partial<Record<FibermapElementType, FibermapProductType>> = {
  CEO: 'SPLICE_CLOSURE',
  CTO: 'TERMINATION_BOX',
  CABINET: 'CABINET',
};

interface ElementGeoRow {
  id: string;
  type: FibermapElementType;
  name: string;
  folder_id: string;
  product_id: string | null;
  product_name: string | null;
  latitude: number;
  longitude: number;
  photos_count: bigint;
  devices_count: bigint;
}

const DETAIL_INCLUDE = {
  product: {
    select: { id: true, name: true, manufacturer: true, specs: true },
  },
  photos: { orderBy: { createdAt: 'desc' as const } },
  _count: { select: { devices: { where: { deletedAt: null } } } },
} satisfies Prisma.FibermapElementInclude;

type ElementDetailRow = Prisma.FibermapElementGetPayload<{
  include: typeof DETAIL_INCLUDE;
}>;

function toResponse(e: ElementDetailRow): FibermapElementResponse {
  return {
    id: e.id,
    folderId: e.folderId,
    type: e.type,
    productId: e.productId,
    product: e.product
      ? {
          id: e.product.id,
          name: e.product.name,
          manufacturer: e.product.manufacturer,
          specs: (e.product.specs ?? {}) as Record<string, unknown>,
        }
      : null,
    name: e.name,
    latitude: Number(e.latitude),
    longitude: Number(e.longitude),
    address: e.address,
    description: e.description,
    metadata: (e.metadata ?? {}) as Record<string, unknown>,
    photos: e.photos.map((p) => ({
      id: p.id,
      fileName: p.fileName,
      caption: p.caption,
      takenAt: p.takenAt ? p.takenAt.toISOString() : null,
      createdAt: p.createdAt.toISOString(),
    })),
    devicesCount: e._count.devices,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
  };
}

@Injectable()
export class FibermapElementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ───────────────────────────────────────────────────────────────────────
  // Leitura de mapa (bbox → GeoJSON) e busca
  // ───────────────────────────────────────────────────────────────────────
  async listGeoJson(
    tenantId: string,
    q: ListFibermapElementsQuery,
  ): Promise<FibermapElementsFeatureCollection> {
    const [minLng, minLat, maxLng, maxLat] = q.bbox;
    // +1 no limit pra detectar truncamento sem COUNT extra.
    const rows = await this.prisma.$queryRaw<ElementGeoRow[]>`
      SELECT e.id, e.type::text AS type, e.name, e.folder_id, e.product_id,
             p.name AS product_name,
             e.latitude::float8 AS latitude, e.longitude::float8 AS longitude,
             (SELECT count(*) FROM fibermap_element_photos ph
               WHERE ph.element_id = e.id) AS photos_count,
             (SELECT count(*) FROM fibermap_devices d
               WHERE d.element_id = e.id AND d.deleted_at IS NULL) AS devices_count
        FROM fibermap_elements e
        LEFT JOIN fibermap_products p ON p.id = e.product_id
       WHERE e.tenant_id = ${tenantId}::uuid
         AND e.deleted_at IS NULL
         AND e.geom && ST_MakeEnvelope(${minLng}, ${minLat}, ${maxLng}, ${maxLat}, 4326)
         ${q.types?.length ? Prisma.sql`AND e.type::text = ANY(${q.types}::text[])` : Prisma.empty}
         ${q.folderId ? Prisma.sql`AND e.folder_id = ${q.folderId}::uuid` : Prisma.empty}
       ORDER BY e.name
       LIMIT ${q.limit + 1}`;

    const truncated = rows.length > q.limit;
    const features: FibermapElementFeature[] = rows
      .slice(0, q.limit)
      .map((r) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [r.longitude, r.latitude] },
        properties: {
          id: r.id,
          type: r.type,
          name: r.name,
          folderId: r.folder_id,
          productId: r.product_id,
          productName: r.product_name,
          photosCount: Number(r.photos_count),
          devicesCount: Number(r.devices_count),
        },
      }));
    return { type: 'FeatureCollection', features, truncated };
  }

  /** Autocomplete do painel esquerdo — voa até o elemento (spec §7). */
  async search(
    tenantId: string,
    q: SearchFibermapElementsQuery,
  ): Promise<FibermapElementSearchHit[]> {
    const rows = await this.prisma.fibermapElement.findMany({
      where: {
        tenantId,
        deletedAt: null,
        name: { contains: q.q, mode: 'insensitive' },
      },
      select: {
        id: true,
        type: true,
        name: true,
        latitude: true,
        longitude: true,
        folderId: true,
      },
      orderBy: { name: 'asc' },
      take: q.limit,
    });
    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      name: r.name,
      latitude: Number(r.latitude),
      longitude: Number(r.longitude),
      folderId: r.folderId,
    }));
  }

  async findById(
    tenantId: string,
    id: string,
  ): Promise<FibermapElementResponse> {
    const e = await this.prisma.fibermapElement.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: DETAIL_INCLUDE,
    });
    if (!e) throw new NotFoundException('Elemento não encontrado');
    return toResponse(e);
  }

  // ───────────────────────────────────────────────────────────────────────
  // Mutações
  // ───────────────────────────────────────────────────────────────────────
  private async validateFolder(tenantId: string, folderId: string) {
    const folder = await this.prisma.fibermapFolder.findFirst({
      where: { id: folderId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!folder) throw new BadRequestException('folderId inválido');
  }

  /** Produto (se dado) precisa existir, estar ativo e casar com o tipo. */
  private async validateProduct(
    tenantId: string,
    elementType: FibermapElementType,
    productId: string,
  ) {
    const product = await this.prisma.fibermapProduct.findFirst({
      where: { id: productId, tenantId, deletedAt: null },
      select: { id: true, type: true, isActive: true },
    });
    if (!product) throw new BadRequestException('productId inválido');
    if (!product.isActive) {
      throw new BadRequestException('Produto desativado no catálogo');
    }
    const expected = PRODUCT_TYPE_BY_ELEMENT[elementType];
    if (expected && product.type !== expected) {
      throw new BadRequestException(
        `Elemento ${elementType} exige produto ${expected} (recebeu ${product.type})`,
      );
    }
  }

  async create(
    tenantId: string,
    actorUserId: string,
    input: CreateFibermapElementRequest,
  ): Promise<FibermapElementResponse> {
    await this.validateFolder(tenantId, input.folderId);
    if (input.productId) {
      await this.validateProduct(tenantId, input.type, input.productId);
    }
    try {
      const created = await this.prisma.fibermapElement.create({
        data: {
          tenantId,
          folderId: input.folderId,
          type: input.type,
          productId: input.productId ?? null,
          name: input.name.trim(),
          latitude: new Prisma.Decimal(input.latitude),
          longitude: new Prisma.Decimal(input.longitude),
          address: input.address ?? null,
          description: input.description ?? null,
          metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
          createdById: actorUserId,
        },
        include: DETAIL_INCLUDE,
      });
      await this.audit.log({
        tenantId,
        userId: actorUserId,
        action: 'fibermap.element.created',
        resource: 'fibermap_elements',
        resourceId: created.id,
        afterState: { type: created.type, name: created.name },
      });
      return toResponse(created);
    } catch (err) {
      this.rethrowUnique(err);
    }
  }

  async update(
    tenantId: string,
    actorUserId: string,
    id: string,
    input: UpdateFibermapElementRequest,
  ): Promise<FibermapElementResponse> {
    const existing = await this.prisma.fibermapElement.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Elemento não encontrado');
    if (input.folderId) await this.validateFolder(tenantId, input.folderId);
    if (input.productId) {
      await this.validateProduct(tenantId, existing.type, input.productId);
    }
    try {
      const updated = await this.prisma.fibermapElement.update({
        where: { id },
        data: {
          folderId: input.folderId,
          productId:
            input.productId === undefined ? undefined : input.productId ?? null,
          name: input.name?.trim(),
          latitude:
            input.latitude === undefined
              ? undefined
              : new Prisma.Decimal(input.latitude),
          longitude:
            input.longitude === undefined
              ? undefined
              : new Prisma.Decimal(input.longitude),
          address: input.address === undefined ? undefined : input.address ?? null,
          description:
            input.description === undefined
              ? undefined
              : input.description ?? null,
          metadata:
            input.metadata === undefined
              ? undefined
              : (input.metadata as Prisma.InputJsonValue),
          updatedById: actorUserId,
        },
        include: DETAIL_INCLUDE,
      });
      // Elemento reposicionado ⇒ pontas dos segmentos acompanham (senão o
      // cabo fica "solto" no mapa). jsonb_set nos extremos do path; o UPDATE
      // dispara a trigger que recalcula geom + comprimento geográfico.
      const moved =
        (input.latitude !== undefined &&
          Number(existing.latitude) !== input.latitude) ||
        (input.longitude !== undefined &&
          Number(existing.longitude) !== input.longitude);
      if (moved) {
        const lng = Number(updated.longitude);
        const lat = Number(updated.latitude);
        await this.prisma.$executeRaw`
          UPDATE fibermap_cable_segments
             SET path = jsonb_set(path, '{0}', to_jsonb(ARRAY[${lng}::float8, ${lat}::float8]))
           WHERE from_element_id = ${id}::uuid AND tenant_id = ${tenantId}::uuid`;
        await this.prisma.$executeRaw`
          UPDATE fibermap_cable_segments
             SET path = jsonb_set(path, '{-1}', to_jsonb(ARRAY[${lng}::float8, ${lat}::float8]))
           WHERE to_element_id = ${id}::uuid AND tenant_id = ${tenantId}::uuid`;
      }

      await this.audit.log({
        tenantId,
        userId: actorUserId,
        action: 'fibermap.element.updated',
        resource: 'fibermap_elements',
        resourceId: id,
      });
      return toResponse(updated);
    } catch (err) {
      this.rethrowUnique(err);
    }
  }

  /** Exclusão só de elemento "solto" (spec §14.2) — sem cascata implícita. */
  async remove(
    tenantId: string,
    actorUserId: string,
    id: string,
  ): Promise<void> {
    const existing = await this.prisma.fibermapElement.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: {
        _count: {
          select: {
            devices: { where: { deletedAt: null } },
            segmentsFrom: true,
            segmentsTo: true,
            slacks: true,
            fiberCuts: true,
            connections: { where: { deletedAt: null } },
          },
        },
      },
    });
    if (!existing) throw new NotFoundException('Elemento não encontrado');
    const c = existing._count;
    const blockers =
      c.devices + c.segmentsFrom + c.segmentsTo + c.slacks + c.fiberCuts + c.connections;
    if (blockers > 0) {
      throw new ConflictException(
        `Elemento em uso (${c.segmentsFrom + c.segmentsTo} segmentos de cabo, ${c.devices} devices, ${c.connections} conexões, ${c.fiberCuts} cortes, ${c.slacks} reservas) — remova as dependências antes`,
      );
    }
    await this.prisma.fibermapElement.update({
      where: { id },
      data: { deletedAt: new Date(), updatedById: actorUserId },
    });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'fibermap.element.deleted',
      resource: 'fibermap_elements',
      resourceId: id,
      beforeState: { type: existing.type, name: existing.name },
    });
  }

  private rethrowUnique(err: unknown): never {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      throw new ConflictException('Já existe um elemento com esse nome na pasta');
    }
    throw err;
  }
}
