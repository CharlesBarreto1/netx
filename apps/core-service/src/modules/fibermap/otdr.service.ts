/**
 * FibermapOtdrService — localizador OTDR + histórico de leituras (FM-5, §5.5).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * A matemática da caminhada é pura (otdr-locate.ts, testada no jest); aqui:
 * validação, carga do componente conexo (reusa o loader do trace),
 * interpolação do ponto via ST_LineInterpolatePoint (fração já convertida
 * pra orientação armazenada — equivale ao ST_Reverse da spec), vizinhos por
 * ST_DWithin e persistência do snapshot em fibermap_otdr_readings (log
 * histórico — leitura sobrevive à remoção de elementos, por isso os nomes
 * são resolvidos best-effort na listagem).
 */
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  FibermapOtdrCandidate,
  FibermapOtdrLocateRequest,
  FibermapOtdrLocateResponse,
  FibermapOtdrReadingItem,
  ListFibermapOtdrReadingsQuery,
} from '@netx/shared';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { FibermapConnectivityGraphService } from './connectivity-graph.service';
import { locateOtdrEvent, type OtdrPureCandidate } from './otdr-locate';
import { TraceGraphError, type TraceGraphData } from './trace-graph';

@Injectable()
export class FibermapOtdrService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly graph: FibermapConnectivityGraphService,
    private readonly audit: AuditService,
  ) {}

  async locate(
    tenantId: string,
    actorUserId: string,
    input: FibermapOtdrLocateRequest,
  ): Promise<FibermapOtdrLocateResponse> {
    const cable = await this.prisma.fibermapCable.findFirst({
      where: { id: input.cableId, tenantId, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!cable) throw new NotFoundException('Cabo não encontrado');
    const fiber = await this.prisma.fibermapFiber.findFirst({
      where: { tenantId, cableId: cable.id, fiberNumber: input.fiberNumber },
      select: { id: true },
    });
    if (!fiber) throw new BadRequestException('Fibra inexistente neste cabo');
    const [refEl, dirEl] = await Promise.all([
      this.prisma.fibermapElement.findFirst({
        where: { id: input.referenceElementId, tenantId, deletedAt: null },
        select: { id: true },
      }),
      this.prisma.fibermapElement.findFirst({
        where: { id: input.directionElementId, tenantId, deletedAt: null },
        select: { id: true },
      }),
    ]);
    if (!refEl || !dirEl) {
      throw new BadRequestException('Elemento de referência/direção inválido');
    }

    const data = await this.graph.loadComponent(tenantId, [fiber.id], []);
    let pure: ReturnType<typeof locateOtdrEvent>;
    try {
      pure = locateOtdrEvent(data, {
        cableId: cable.id,
        fiberNumber: input.fiberNumber,
        referenceElementId: input.referenceElementId,
        directionElementId: input.directionElementId,
        distanceM: input.distanceM,
      });
    } catch (err) {
      if (err instanceof TraceGraphError) throw new BadRequestException(err.message);
      throw err;
    }

    const candidates: FibermapOtdrCandidate[] = [];
    for (const c of pure.candidates) {
      candidates.push(await this.resolveCandidate(data, c));
    }
    const primary = candidates[0] ?? null;
    const nearestElements = primary
      ? await this.nearestElements(tenantId, primary.latitude, primary.longitude)
      : [];

    const snapshot = {
      flags: pure.flags,
      point: primary
        ? { latitude: primary.latitude, longitude: primary.longitude }
        : null,
      uncertaintyRadiusM: primary?.uncertaintyRadiusM ?? null,
      candidates,
      nearestElements,
      expectedEvents: pure.expectedEvents,
    };

    const reading = await this.prisma.fibermapOtdrReading.create({
      data: {
        tenantId,
        referenceKind: 'ELEMENT',
        referenceElementId: input.referenceElementId,
        cableId: cable.id,
        fiberNumber: input.fiberNumber,
        directionElementId: input.directionElementId,
        distanceM: new Prisma.Decimal(input.distanceM),
        wavelengthNm: input.wavelengthNm,
        eventType: input.eventType,
        result: snapshot as unknown as Prisma.InputJsonValue,
        createdById: actorUserId,
      },
      select: { id: true },
    });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'fibermap.otdr.located',
      resource: 'fibermap_otdr_readings',
      resourceId: reading.id,
      afterState: {
        cable: cable.name,
        fiber: input.fiberNumber,
        distanceM: input.distanceM,
        flags: pure.flags,
      },
    });

    return { readingId: reading.id, ...snapshot };
  }

  /** Ponto físico do candidato: interpolação PostGIS ou coordenada da caixa. */
  private async resolveCandidate(
    data: TraceGraphData,
    c: OtdrPureCandidate,
  ): Promise<FibermapOtdrCandidate> {
    if (c.kind === 'ON_SEGMENT') {
      const rows = await this.prisma.$queryRaw<Array<{ lat: number; lng: number }>>`
        SELECT ST_Y(ST_LineInterpolatePoint(geom, ${c.geoFractionStored}::float8))::float8 AS lat,
               ST_X(ST_LineInterpolatePoint(geom, ${c.geoFractionStored}::float8))::float8 AS lng
          FROM fibermap_cable_segments
         WHERE id = ${c.segment!.id}::uuid AND geom IS NOT NULL`;
      const row = rows[0];
      if (!row) {
        throw new BadRequestException(
          'Segmento sem geometria — trigger PostGIS não populou o geom',
        );
      }
      return {
        kind: c.kind,
        latitude: row.lat,
        longitude: row.lng,
        uncertaintyRadiusM: c.uncertaintyRadiusM,
        branchLabel: c.branchLabel,
        cableId: c.cable!.id,
        cableName: c.cable!.name,
        segmentId: c.segment!.id,
        betweenElements: [
          data.elements[c.walkFromElementId!]?.name ?? '?',
          data.elements[c.walkToElementId!]?.name ?? '?',
        ],
        offsetM: c.offsetOpticalM,
      };
    }
    const el = c.elementId ? data.elements[c.elementId] : undefined;
    return {
      kind: c.kind,
      latitude: el?.latitude ?? 0,
      longitude: el?.longitude ?? 0,
      uncertaintyRadiusM: c.uncertaintyRadiusM,
      branchLabel: c.branchLabel,
      ...(c.cable ? { cableId: c.cable.id, cableName: c.cable.name } : {}),
      elementId: c.elementId,
      elementName: el?.name,
    };
  }

  /** Elementos num raio de 250 m do ponto (spec §5.5.7 — nearest_elements). */
  private async nearestElements(
    tenantId: string,
    latitude: number,
    longitude: number,
  ): Promise<Array<{ id: string; name: string; distanceM: number }>> {
    const rows = await this.prisma.$queryRaw<
      Array<{ id: string; name: string; d: number }>
    >`
      SELECT id, name,
             ST_Distance(geom::geography,
                         ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geography)::float8 AS d
        FROM fibermap_elements
       WHERE tenant_id = ${tenantId}::uuid
         AND deleted_at IS NULL
         AND geom IS NOT NULL
         AND ST_DWithin(geom::geography,
                        ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geography, 250)
       ORDER BY d ASC
       LIMIT 3`;
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      distanceM: Math.round(r.d * 10) / 10,
    }));
  }

  async listReadings(
    tenantId: string,
    q: ListFibermapOtdrReadingsQuery,
  ): Promise<FibermapOtdrReadingItem[]> {
    const rows = await this.prisma.fibermapOtdrReading.findMany({
      where: { tenantId, ...(q.cableId ? { cableId: q.cableId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: q.limit,
    });
    const cableIds = [...new Set(rows.map((r) => r.cableId))];
    const elementIds = [
      ...new Set(
        rows.flatMap((r) =>
          [r.referenceElementId, r.directionElementId].filter(
            (v): v is string => Boolean(v),
          ),
        ),
      ),
    ];
    const [cables, elements] = await Promise.all([
      cableIds.length
        ? this.prisma.fibermapCable.findMany({
            where: { id: { in: cableIds } },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
      elementIds.length
        ? this.prisma.fibermapElement.findMany({
            where: { id: { in: elementIds } },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
    ]);
    const cableName = new Map(cables.map((c) => [c.id, c.name]));
    const elementName = new Map(elements.map((e) => [e.id, e.name]));
    return rows.map((r) => ({
      id: r.id,
      cableId: r.cableId,
      cableName: cableName.get(r.cableId) ?? null,
      fiberNumber: r.fiberNumber,
      referenceElementId: r.referenceElementId,
      referenceElementName: r.referenceElementId
        ? (elementName.get(r.referenceElementId) ?? null)
        : null,
      directionElementId: r.directionElementId,
      directionElementName: elementName.get(r.directionElementId) ?? null,
      distanceM: Number(r.distanceM),
      wavelengthNm: r.wavelengthNm,
      eventType: r.eventType,
      createdAt: r.createdAt.toISOString(),
      result: r.result,
    }));
  }
}
