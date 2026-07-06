/**
 * CoverageService — consulta de cobertura pro NetX Field (nova venda / campo):
 * dado um ponto (lat/lng), quais CTOs têm porta livre por perto?
 *
 * Leitura pura sobre o FiberMap (OSP v2): elementos type=CTO + portas OUT dos
 * splitters. Busca por raio via PostGIS (ST_DWithin/KNN sobre o geom mantido
 * por trigger — mesmo padrão do FibermapSubscriberService.searchCtos). Porta
 * livre = sem contrato vinculado (contracts.fibermap_port_id) E sem face
 * física ocupada no grafo (fibermap_connection_endpoints PORT:{id}:C|F).
 * Não escreve, não é dono de schema.
 */
import { Injectable } from '@nestjs/common';
import { fibermapPortKey } from '@netx/shared';
import type {
  CoverageCheckQuery,
  CoverageCheckResponse,
  CoverageEnclosure,
} from '@netx/shared';

import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CoverageService {
  constructor(private readonly prisma: PrismaService) {}

  async check(tenantId: string, q: CoverageCheckQuery): Promise<CoverageCheckResponse> {
    // CTOs vivas dentro do raio, já ordenadas por distância (KNN no GiST).
    const nearby = await this.prisma.$queryRaw<
      Array<{ id: string; distance_m: number }>
    >`
      SELECT e.id,
             ST_Distance(e.geom::geography,
                         ST_SetSRID(ST_MakePoint(${q.longitude}, ${q.latitude}), 4326)::geography
             )::float8 AS distance_m
        FROM fibermap_elements e
       WHERE e.tenant_id = ${tenantId}::uuid
         AND e.type = 'CTO'
         AND e.deleted_at IS NULL
         AND ST_DWithin(e.geom::geography,
                        ST_SetSRID(ST_MakePoint(${q.longitude}, ${q.latitude}), 4326)::geography,
                        ${q.radiusMeters})
       ORDER BY e.geom <-> ST_SetSRID(ST_MakePoint(${q.longitude}, ${q.latitude}), 4326)`;

    const queryOut = {
      latitude: q.latitude,
      longitude: q.longitude,
      radiusMeters: q.radiusMeters,
    };
    if (nearby.length === 0) {
      return { query: queryOut, enclosures: [], covered: false };
    }

    const distById = new Map(nearby.map((r) => [r.id, Math.round(Number(r.distance_m))]));

    const elements = await this.prisma.fibermapElement.findMany({
      where: { id: { in: nearby.map((r) => r.id) }, tenantId, deletedAt: null },
      select: {
        id: true,
        name: true,
        latitude: true,
        longitude: true,
        devices: {
          where: { type: 'SPLITTER', deletedAt: null },
          select: { ports: { where: { role: 'OUT' }, select: { id: true } } },
        },
      },
    });

    // Ocupação em lote: comercial (contrato na porta) + física (face C/F no grafo).
    const portIds = elements.flatMap((e) => e.devices.flatMap((d) => d.ports.map((p) => p.id)));
    const [busyPhysical, assigned] = await Promise.all([
      this.findConnectedPortIds(portIds),
      portIds.length
        ? this.prisma.contract.findMany({
            where: { tenantId, fibermapPortId: { in: portIds }, deletedAt: null },
            select: { fibermapPortId: true },
          })
        : Promise.resolve([]),
    ]);
    const assignedSet = new Set(assigned.map((a) => a.fibermapPortId as string));

    const within: CoverageEnclosure[] = [];
    for (const e of elements) {
      const ports = e.devices.flatMap((d) => d.ports);
      const portsTotal = ports.length;
      const portsFree = ports.filter(
        (p) => !assignedSet.has(p.id) && !busyPhysical.has(p.id),
      ).length;
      const hasFreePort = portsFree > 0;
      if (q.onlyWithFreePort && !hasFreePort) continue;

      within.push({
        id: e.id,
        code: e.name,
        type: 'CTO',
        latitude: Number(e.latitude),
        longitude: Number(e.longitude),
        distanceMeters: distById.get(e.id) ?? 0,
        // FiberMap não tem "capacidade declarada" da caixa — a capacidade real
        // é o total de portas OUT dos splitters (igual a portsTotal; campo
        // mantido por compat de shape com o app).
        capacity: portsTotal,
        portsTotal,
        portsFree,
        hasFreePort,
      });
    }

    within.sort((a, b) => a.distanceMeters - b.distanceMeters);
    const enclosuresOut = within.slice(0, q.limit);

    return {
      query: queryOut,
      enclosures: enclosuresOut,
      covered: enclosuresOut.some((e) => e.hasFreePort),
    };
  }

  /** Ids de portas com QUALQUER face (conector/fusão) ocupada no grafo. */
  private async findConnectedPortIds(portIds: string[]): Promise<Set<string>> {
    if (portIds.length === 0) return new Set();
    const keys = portIds.flatMap((id) => [
      fibermapPortKey(id, 'CONNECTOR'),
      fibermapPortKey(id, 'FUSION'),
    ]);
    const used = await this.prisma.fibermapConnectionEndpoint.findMany({
      where: { endpointKey: { in: keys } },
      select: { endpointKey: true },
    });
    return new Set(used.map((u) => u.endpointKey.split(':')[1]));
  }
}
