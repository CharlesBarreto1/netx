/**
 * FibermapCablesService — cabos, segmentos e reservas (FM-2, spec §3.4, §14).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Regras aplicadas aqui (não só na UI):
 *  - Cabo nasce SEMPRE de um modelo do catálogo (instantiate-cable: snapshot
 *    + tubos + fibras). Sem produto só via import KML (FM-7).
 *  - Segmentos formam cadeia contígua: from do seq N+1 = to do seq N (§14.4);
 *    path é forçado a começar/terminar nas coords dos elementos.
 *  - Comprimento geográfico vem da trigger PostGIS (ST_Length::geography);
 *    óptico = coalesce(medido, geográfico × excessFactor); reservas somam no
 *    total óptico do cabo (§5.2).
 *  - DELETE de cabo bloqueado com fusões/cortes nas fibras (§14.2); DELETE de
 *    segmento só o último da cadeia (preserva contiguidade).
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  CreateFibermapCableRequest,
  CreateFibermapSegmentRequest,
  CreateFibermapSlackRequest,
  FibermapCalibrateExcessRequest,
  FibermapCalibrateExcessResponse,
  FibermapCableResponse,
  FibermapCableStub,
  FibermapCablesFeatureCollection,
  FibermapPathPoint,
  FibermapSegmentResponse,
  ListFibermapCablesQuery,
  UpdateFibermapCableRequest,
  UpdateFibermapSegmentRequest,
} from '@netx/shared';
import { FibermapBboxSchema } from '@netx/shared';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  FibermapCatalogError,
  instantiateCableFromModel,
} from './instantiate-cable';
import { fitExcessFactor } from './otdr-locate';
import { TraceGraphError } from './trace-graph';

/** API {lat,lng} → GeoJSON [[lng,lat],…] (formato do banco/trigger). */
function toGeoJsonCoords(path: FibermapPathPoint[]): number[][] {
  return path.map((p) => [p.longitude, p.latitude]);
}
function fromGeoJsonCoords(raw: unknown): FibermapPathPoint[] {
  if (!Array.isArray(raw)) return [];
  return (raw as [number, number][]).map(([lng, lat]) => ({
    latitude: lat,
    longitude: lng,
  }));
}

function opticalLength(
  geometric: Prisma.Decimal,
  measured: Prisma.Decimal | null,
  excess: Prisma.Decimal,
): number {
  if (measured) return Number(measured);
  return Math.round(Number(geometric) * Number(excess) * 100) / 100;
}

const CABLE_INCLUDE = {
  product: { select: { name: true } },
  tubes: { orderBy: { tubeNumber: 'asc' as const } },
  segments: {
    orderBy: { seq: 'asc' as const },
    include: {
      fromElement: { select: { name: true } },
      toElement: { select: { name: true } },
    },
  },
  slacks: {
    orderBy: { createdAt: 'asc' as const },
    include: { element: { select: { name: true } } },
  },
} satisfies Prisma.FibermapCableInclude;

type CableRow = Prisma.FibermapCableGetPayload<{ include: typeof CABLE_INCLUDE }>;

@Injectable()
export class FibermapCablesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ───────────────────────────────────────────────────────────────────────
  // Leitura
  // ───────────────────────────────────────────────────────────────────────
  async listGeoJson(
    tenantId: string,
    q: ListFibermapCablesQuery,
  ): Promise<FibermapCablesFeatureCollection> {
    const bbox = FibermapBboxSchema.parse(q.bbox);
    const [minLng, minLat, maxLng, maxLat] = bbox;
    const rows = await this.prisma.$queryRaw<
      Array<{
        segment_id: string;
        cable_id: string;
        cable_name: string;
        seq: number;
        display_color: string | null;
        fiber_count: number;
        path: unknown;
        geometric_length_m: number;
        measured_length_m: number | null;
        excess_factor: number;
      }>
    >`
      SELECT s.id AS segment_id, c.id AS cable_id, c.name AS cable_name, s.seq,
             c.display_color, c.fiber_count, s.path,
             s.geometric_length_m::float8 AS geometric_length_m,
             s.measured_length_m::float8 AS measured_length_m,
             c.excess_factor::float8 AS excess_factor
        FROM fibermap_cable_segments s
        JOIN fibermap_cables c ON c.id = s.cable_id AND c.deleted_at IS NULL
       WHERE s.tenant_id = ${tenantId}::uuid
         AND s.geom && ST_MakeEnvelope(${minLng}, ${minLat}, ${maxLng}, ${maxLat}, 4326)
         ${q.folderId ? Prisma.sql`AND c.folder_id = ${q.folderId}::uuid` : Prisma.empty}
       ORDER BY c.name, s.seq
       LIMIT ${q.limit + 1}`;

    const truncated = rows.length > q.limit;
    return {
      type: 'FeatureCollection',
      truncated,
      features: rows.slice(0, q.limit).map((r) => ({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: (Array.isArray(r.path) ? r.path : []) as [number, number][],
        },
        properties: {
          segmentId: r.segment_id,
          cableId: r.cable_id,
          cableName: r.cable_name,
          seq: r.seq,
          displayColor: r.display_color ?? '#64748b',
          fiberCount: r.fiber_count,
          geometricLengthM: r.geometric_length_m,
          measuredLengthM: r.measured_length_m,
          opticalLengthM:
            r.measured_length_m ??
            Math.round(r.geometric_length_m * r.excess_factor * 100) / 100,
        },
      })),
    };
  }

  async findById(tenantId: string, id: string): Promise<FibermapCableResponse> {
    const cable = await this.prisma.fibermapCable.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: CABLE_INCLUDE,
    });
    if (!cable) throw new NotFoundException('Cabo não encontrado');
    return this.toResponse(cable);
  }

  /** Cabos cuja ponta final é `elementId` — opções de "continuar cabo". */
  async stubsEndingAt(
    tenantId: string,
    elementId: string,
  ): Promise<FibermapCableStub[]> {
    const cables = await this.prisma.fibermapCable.findMany({
      where: { tenantId, deletedAt: null },
      select: {
        id: true,
        name: true,
        fiberCount: true,
        displayColor: true,
        segments: {
          orderBy: { seq: 'desc' },
          take: 1,
          select: { toElementId: true, seq: true },
        },
      },
    });
    return cables
      .filter(
        (c) =>
          // sem segmentos = cabo recém-criado, pode começar em qualquer lugar
          c.segments.length === 0 || c.segments[0].toElementId === elementId,
      )
      .map((c) => ({
        id: c.id,
        name: c.name,
        fiberCount: c.fiberCount,
        displayColor: c.displayColor,
        tailElementId: c.segments[0]?.toElementId ?? null,
        segmentsCount: c.segments[0]?.seq ?? 0,
      }));
  }

  // ───────────────────────────────────────────────────────────────────────
  // Mutações — cabo
  // ───────────────────────────────────────────────────────────────────────
  async create(
    tenantId: string,
    actorUserId: string,
    input: CreateFibermapCableRequest,
  ): Promise<FibermapCableResponse> {
    const folder = await this.prisma.fibermapFolder.findFirst({
      where: { id: input.folderId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!folder) throw new BadRequestException('folderId inválido');
    try {
      const { cableId, fibersCreated } = await instantiateCableFromModel(
        this.prisma,
        {
          tenantId,
          actorUserId,
          folderId: input.folderId,
          name: input.name,
          productId: input.productId,
          displayColor: input.displayColor ?? undefined,
          notes: input.notes ?? null,
        },
      );
      await this.audit.log({
        tenantId,
        userId: actorUserId,
        action: 'fibermap.cable.created',
        resource: 'fibermap_cables',
        resourceId: cableId,
        afterState: { name: input.name, fibersCreated },
      });
      return this.findById(tenantId, cableId);
    } catch (err) {
      if (err instanceof FibermapCatalogError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }
  }

  async update(
    tenantId: string,
    actorUserId: string,
    id: string,
    input: UpdateFibermapCableRequest,
  ): Promise<FibermapCableResponse> {
    const existing = await this.prisma.fibermapCable.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Cabo não encontrado');
    if (input.folderId) {
      const folder = await this.prisma.fibermapFolder.findFirst({
        where: { id: input.folderId, tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!folder) throw new BadRequestException('folderId inválido');
    }
    await this.prisma.fibermapCable.update({
      where: { id },
      data: {
        folderId: input.folderId,
        name: input.name?.trim(),
        displayColor:
          input.displayColor === undefined ? undefined : input.displayColor,
        notes: input.notes === undefined ? undefined : input.notes ?? null,
        excessFactor:
          input.excessFactor === undefined
            ? undefined
            : new Prisma.Decimal(input.excessFactor),
        updatedById: actorUserId,
      },
    });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'fibermap.cable.updated',
      resource: 'fibermap_cables',
      resourceId: id,
    });
    return this.findById(tenantId, id);
  }

  /** Bloqueado com fusões/cortes ativos nas fibras (spec §14.2). */
  async remove(tenantId: string, actorUserId: string, id: string): Promise<void> {
    const existing = await this.prisma.fibermapCable.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!existing) throw new NotFoundException('Cabo não encontrado');
    const [connections, cuts] = await this.prisma.$transaction([
      this.prisma.fibermapOpticalConnection.count({
        where: {
          tenantId,
          deletedAt: null,
          OR: [{ aFiber: { cableId: id } }, { bFiber: { cableId: id } }],
        },
      }),
      this.prisma.fibermapFiberCut.count({
        where: { tenantId, fiber: { cableId: id } },
      }),
    ]);
    if (connections + cuts > 0) {
      throw new ConflictException(
        `Cabo em uso (${connections} fusões/conexões, ${cuts} cortes) — desfaça no ponto de acesso antes`,
      );
    }
    // Soft delete do cabo; segmentos/fibras/tubos ficam (histórico) mas somem
    // das listagens via join com deleted_at do cabo.
    await this.prisma.fibermapCable.update({
      where: { id },
      data: { deletedAt: new Date(), updatedById: actorUserId },
    });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'fibermap.cable.deleted',
      resource: 'fibermap_cables',
      resourceId: id,
      beforeState: { name: existing.name },
    });
  }

  /**
   * Calibração OTDR (FM-6, spec §5.5.8): 2+ eventos identificados na curva
   * (teórico × medido) ajustam o excess_factor DA INSTÂNCIA (§14.10 — nunca
   * o produto) por mínimos quadrados pela origem.
   */
  async calibrateExcess(
    tenantId: string,
    actorUserId: string,
    id: string,
    input: FibermapCalibrateExcessRequest,
  ): Promise<FibermapCalibrateExcessResponse> {
    const cable = await this.prisma.fibermapCable.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true, name: true, excessFactor: true },
    });
    if (!cable) throw new NotFoundException('Cabo não encontrado');
    const oldExcessFactor = Number(cable.excessFactor);
    let fit;
    try {
      fit = fitExcessFactor(oldExcessFactor, input.pairs);
    } catch (err) {
      if (err instanceof TraceGraphError) throw new BadRequestException(err.message);
      throw err;
    }
    await this.prisma.fibermapCable.update({
      where: { id },
      data: {
        excessFactor: new Prisma.Decimal(fit.newExcessFactor),
        updatedById: actorUserId,
      },
    });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'fibermap.cable.calibrated',
      resource: 'fibermap_cables',
      resourceId: id,
      beforeState: { excessFactor: oldExcessFactor },
      afterState: {
        excessFactor: fit.newExcessFactor,
        k: fit.k,
        pairs: input.pairs.length,
        clamped: fit.clamped,
      },
    });
    return {
      cableId: id,
      k: fit.k,
      oldExcessFactor,
      newExcessFactor: fit.newExcessFactor,
      clamped: fit.clamped,
    };
  }

  // ───────────────────────────────────────────────────────────────────────
  // Mutações — segmentos
  // ───────────────────────────────────────────────────────────────────────
  async addSegment(
    tenantId: string,
    actorUserId: string,
    cableId: string,
    input: CreateFibermapSegmentRequest,
  ): Promise<FibermapCableResponse> {
    const cable = await this.prisma.fibermapCable.findFirst({
      where: { id: cableId, tenantId, deletedAt: null },
      include: { segments: { orderBy: { seq: 'desc' }, take: 1 } },
    });
    if (!cable) throw new NotFoundException('Cabo não encontrado');

    const [fromEl, toEl] = await Promise.all([
      this.prisma.fibermapElement.findFirst({
        where: { id: input.fromElementId, tenantId, deletedAt: null },
        select: { id: true, latitude: true, longitude: true },
      }),
      this.prisma.fibermapElement.findFirst({
        where: { id: input.toElementId, tenantId, deletedAt: null },
        select: { id: true, latitude: true, longitude: true },
      }),
    ]);
    if (!fromEl || !toEl) {
      throw new BadRequestException('Elemento de origem/destino inválido');
    }
    if (input.fromElementId === input.toElementId) {
      throw new BadRequestException('Origem e destino não podem ser o mesmo elemento');
    }

    // Cadeia contígua (§14.4): novo from = to do último segmento.
    const last = cable.segments[0];
    if (last && last.toElementId !== input.fromElementId) {
      throw new ConflictException(
        'Segmento fora da cadeia: o cabo termina em outro elemento — continue a partir da ponta atual',
      );
    }

    // Força as pontas do path nas coords reais dos elementos (conexão visual
    // e insumo correto pro comprimento geográfico).
    const path = [...input.path];
    path[0] = { latitude: Number(fromEl.latitude), longitude: Number(fromEl.longitude) };
    path[path.length - 1] = {
      latitude: Number(toEl.latitude),
      longitude: Number(toEl.longitude),
    };

    const created = await this.prisma.fibermapCableSegment.create({
      data: {
        tenantId,
        cableId,
        seq: (last?.seq ?? 0) + 1,
        fromElementId: input.fromElementId,
        toElementId: input.toElementId,
        path: toGeoJsonCoords(path) as Prisma.InputJsonValue,
        measuredLengthM:
          input.measuredLengthM == null
            ? null
            : new Prisma.Decimal(input.measuredLengthM),
      },
      select: { id: true, seq: true },
    });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'fibermap.segment.created',
      resource: 'fibermap_cable_segments',
      resourceId: created.id,
      afterState: { cableId, seq: created.seq },
    });
    return this.findById(tenantId, cableId);
  }

  async updateSegment(
    tenantId: string,
    actorUserId: string,
    segmentId: string,
    input: UpdateFibermapSegmentRequest,
  ): Promise<FibermapCableResponse> {
    const segment = await this.prisma.fibermapCableSegment.findFirst({
      where: { id: segmentId, tenantId, cable: { deletedAt: null } },
      include: {
        fromElement: { select: { latitude: true, longitude: true } },
        toElement: { select: { latitude: true, longitude: true } },
      },
    });
    if (!segment) throw new NotFoundException('Segmento não encontrado');

    let pathJson: Prisma.InputJsonValue | undefined;
    if (input.path) {
      const path = [...input.path];
      path[0] = {
        latitude: Number(segment.fromElement.latitude),
        longitude: Number(segment.fromElement.longitude),
      };
      path[path.length - 1] = {
        latitude: Number(segment.toElement.latitude),
        longitude: Number(segment.toElement.longitude),
      };
      pathJson = toGeoJsonCoords(path) as Prisma.InputJsonValue;
    }

    await this.prisma.fibermapCableSegment.update({
      where: { id: segmentId },
      data: {
        path: pathJson,
        measuredLengthM:
          input.measuredLengthM === undefined
            ? undefined
            : input.measuredLengthM === null
              ? null
              : new Prisma.Decimal(input.measuredLengthM),
      },
    });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'fibermap.segment.updated',
      resource: 'fibermap_cable_segments',
      resourceId: segmentId,
    });
    return this.findById(tenantId, segment.cableId);
  }

  /** Só o ÚLTIMO da cadeia — mantém a contiguidade (§14.4). */
  async removeSegment(
    tenantId: string,
    actorUserId: string,
    segmentId: string,
  ): Promise<FibermapCableResponse> {
    const segment = await this.prisma.fibermapCableSegment.findFirst({
      where: { id: segmentId, tenantId, cable: { deletedAt: null } },
      select: { id: true, cableId: true, seq: true },
    });
    if (!segment) throw new NotFoundException('Segmento não encontrado');
    const last = await this.prisma.fibermapCableSegment.findFirst({
      where: { cableId: segment.cableId },
      orderBy: { seq: 'desc' },
      select: { id: true },
    });
    if (last?.id !== segment.id) {
      throw new ConflictException(
        'Só o último segmento da cadeia pode ser removido',
      );
    }
    // Reservas do segmento caem junto (FK cascade) — a UI confirma antes.
    await this.prisma.fibermapCableSegment.delete({ where: { id: segmentId } });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'fibermap.segment.deleted',
      resource: 'fibermap_cable_segments',
      resourceId: segmentId,
      beforeState: { cableId: segment.cableId, seq: segment.seq },
    });
    return this.findById(tenantId, segment.cableId);
  }

  // ───────────────────────────────────────────────────────────────────────
  // Mutações — reservas técnicas
  // ───────────────────────────────────────────────────────────────────────
  async addSlack(
    tenantId: string,
    actorUserId: string,
    cableId: string,
    input: CreateFibermapSlackRequest,
  ): Promise<FibermapCableResponse> {
    const segment = await this.prisma.fibermapCableSegment.findFirst({
      where: { id: input.segmentId, tenantId, cableId },
      select: { id: true, fromElementId: true, toElementId: true },
    });
    if (!segment) throw new BadRequestException('segmentId inválido pra este cabo');
    // A sobra fica enrolada numa PONTA do segmento (MVP AT_ELEMENT — spec §3.4).
    if (
      input.elementId !== segment.fromElementId &&
      input.elementId !== segment.toElementId
    ) {
      throw new BadRequestException(
        'A reserva deve ficar num elemento que é ponta do segmento',
      );
    }
    const created = await this.prisma.fibermapCableSlack.create({
      data: {
        tenantId,
        cableId,
        elementId: input.elementId,
        segmentId: input.segmentId,
        lengthM: new Prisma.Decimal(input.lengthM),
        createdById: actorUserId,
      },
      select: { id: true },
    });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'fibermap.slack.created',
      resource: 'fibermap_cable_slacks',
      resourceId: created.id,
      afterState: { cableId, lengthM: input.lengthM },
    });
    return this.findById(tenantId, cableId);
  }

  async removeSlack(
    tenantId: string,
    actorUserId: string,
    slackId: string,
  ): Promise<FibermapCableResponse> {
    const slack = await this.prisma.fibermapCableSlack.findFirst({
      where: { id: slackId, tenantId },
      select: { id: true, cableId: true },
    });
    if (!slack) throw new NotFoundException('Reserva não encontrada');
    await this.prisma.fibermapCableSlack.delete({ where: { id: slackId } });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'fibermap.slack.deleted',
      resource: 'fibermap_cable_slacks',
      resourceId: slackId,
    });
    return this.findById(tenantId, slack.cableId);
  }

  // ───────────────────────────────────────────────────────────────────────
  private async toResponse(cable: CableRow): Promise<FibermapCableResponse> {
    const excess = cable.excessFactor;
    const slacksBySegment = new Map<string, CableRow['slacks']>();
    for (const s of cable.slacks) {
      const list = slacksBySegment.get(s.segmentId) ?? [];
      list.push(s);
      slacksBySegment.set(s.segmentId, list);
    }
    const segments: FibermapSegmentResponse[] = cable.segments.map((s) => ({
      id: s.id,
      seq: s.seq,
      fromElementId: s.fromElementId,
      fromElementName: s.fromElement.name,
      toElementId: s.toElementId,
      toElementName: s.toElement.name,
      path: fromGeoJsonCoords(s.path),
      geometricLengthM: Number(s.geometricLengthM),
      measuredLengthM: s.measuredLengthM ? Number(s.measuredLengthM) : null,
      opticalLengthM: opticalLength(s.geometricLengthM, s.measuredLengthM, excess),
      slacks: (slacksBySegment.get(s.id) ?? []).map((sl) => ({
        id: sl.id,
        elementId: sl.elementId,
        elementName: sl.element.name,
        segmentId: sl.segmentId,
        lengthM: Number(sl.lengthM),
        createdAt: sl.createdAt.toISOString(),
      })),
    }));

    const occupancyRows = await this.prisma.fibermapFiber.groupBy({
      by: ['status'],
      where: { cableId: cable.id },
      _count: true,
    });
    const byStatus = Object.fromEntries(
      occupancyRows.map((r) => [r.status, r._count]),
    ) as Partial<Record<'DARK' | 'ACTIVE' | 'RESERVED' | 'BROKEN', number>>;

    const totalGeometricM = segments.reduce((a, s) => a + s.geometricLengthM, 0);
    const totalSlackM = cable.slacks.reduce((a, s) => a + Number(s.lengthM), 0);
    const totalOpticalM =
      segments.reduce((a, s) => a + s.opticalLengthM, 0) + totalSlackM;

    return {
      id: cable.id,
      folderId: cable.folderId,
      name: cable.name,
      productId: cable.productId,
      productName: cable.product?.name ?? null,
      fiberCount: cable.fiberCount,
      tubeCount: cable.tubeCount,
      fibersPerTube: cable.fibersPerTube,
      colorStandard: cable.colorStandard,
      excessFactor: Number(cable.excessFactor),
      displayColor: cable.displayColor,
      notes: cable.notes,
      tubes: cable.tubes.map((t) => ({ tubeNumber: t.tubeNumber, color: t.color })),
      segments,
      occupancy: {
        total: cable.fiberCount,
        dark: byStatus.DARK ?? 0,
        active: byStatus.ACTIVE ?? 0,
        reserved: byStatus.RESERVED ?? 0,
        broken: byStatus.BROKEN ?? 0,
      },
      totalGeometricM: Math.round(totalGeometricM * 100) / 100,
      totalOpticalM: Math.round(totalOpticalM * 100) / 100,
      totalSlackM: Math.round(totalSlackM * 100) / 100,
      createdAt: cable.createdAt.toISOString(),
      updatedAt: cable.updatedAt.toISOString(),
    };
  }
}
