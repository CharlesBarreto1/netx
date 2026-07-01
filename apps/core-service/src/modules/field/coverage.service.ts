/**
 * CoverageService — consulta de cobertura pro NetX Field (nova venda / campo):
 * dado um ponto (lat/lng), quais CTOs/NAPs têm porta livre por perto?
 *
 * Leitura pura sobre a rede óptica (OpticalEnclosure/OpticalPort). Busca por
 * raio via Haversine EM MEMÓRIA (sem PostGIS) — coerente com o restante do
 * código óptico. Escala fina (centenas/poucos milhares de caixas por tenant);
 * se crescer, migrar pra índice geoespacial. Não escreve, não é dono de schema.
 */
import { Injectable } from '@nestjs/common';
import type {
  CoverageCheckQuery,
  CoverageCheckResponse,
  CoverageEnclosure,
} from '@netx/shared';

import { PrismaService } from '../prisma/prisma.service';

const EARTH_RADIUS_M = 6_371_000;

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

@Injectable()
export class CoverageService {
  constructor(private readonly prisma: PrismaService) {}

  async check(tenantId: string, q: CoverageCheckQuery): Promise<CoverageCheckResponse> {
    // Só caixas que atendem assinante (CTO/NAP), ativas e não deletadas.
    const enclosures = await this.prisma.opticalEnclosure.findMany({
      where: {
        tenantId,
        deletedAt: null,
        isActive: true,
        type: { in: ['CTO', 'NAP'] },
      },
      select: {
        id: true,
        code: true,
        type: true,
        latitude: true,
        longitude: true,
        capacity: true,
        ports: { select: { status: true } },
      },
    });

    const within: CoverageEnclosure[] = [];
    for (const e of enclosures) {
      const lat = Number(e.latitude);
      const lng = Number(e.longitude);
      const distanceMeters = Math.round(haversineMeters(q.latitude, q.longitude, lat, lng));
      if (distanceMeters > q.radiusMeters) continue;

      const portsTotal = e.ports.length;
      const portsFree = e.ports.filter((p) => p.status === 'FREE').length;
      const hasFreePort = portsFree > 0;
      if (q.onlyWithFreePort && !hasFreePort) continue;

      within.push({
        id: e.id,
        code: e.code,
        type: e.type as CoverageEnclosure['type'],
        latitude: lat,
        longitude: lng,
        distanceMeters,
        capacity: e.capacity,
        portsTotal,
        portsFree,
        hasFreePort,
      });
    }

    within.sort((a, b) => a.distanceMeters - b.distanceMeters);
    const enclosuresOut = within.slice(0, q.limit);

    return {
      query: { latitude: q.latitude, longitude: q.longitude, radiusMeters: q.radiusMeters },
      enclosures: enclosuresOut,
      covered: enclosuresOut.some((e) => e.hasFreePort),
    };
  }
}
