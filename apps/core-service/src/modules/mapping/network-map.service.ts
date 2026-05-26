/**
 * NetworkMapService — pontos pra mapa de Rede (POPs + Equipamentos + OLTs).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Junta os 3 inventários físicos com lat/lng em uma response única.
 * NetworkPop (sites) + NetworkEquipment (BNG/Router/Switch — multi-vendor)
 * + Olt (modelo rico do provisioning, separado por design).
 *
 * Ignora rows sem lat/lng (mostra a contagem em stats.withoutGeo pra UI
 * sugerir "X equipamentos sem coordenada — marcar no mapa").
 */
import { Injectable } from '@nestjs/common';
import type {
  ListNetworkMapQuery,
  NetworkMapPoint,
  NetworkMapPointKind,
  NetworkMapResponse,
  NetworkMapSegment,
} from '@netx/shared';

import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class NetworkMapService {
  constructor(private readonly prisma: PrismaService) {}

  async listPoints(
    tenantId: string,
    query: ListNetworkMapQuery,
  ): Promise<NetworkMapResponse> {
    const points: NetworkMapPoint[] = [];
    const segments: NetworkMapSegment[] = [];

    // ── Stats: contamos "withoutGeo" por tipo, separado da response principal.
    let popsCount = 0;
    let equipmentCount = 0;
    let oltsCount = 0;
    let enclosuresCount = 0;
    let cablesCount = 0;
    let withoutGeo = 0;

    if (query.includePops !== false) {
      const allPops = await this.prisma.networkPop.findMany({
        where: { tenantId, deletedAt: null },
        select: {
          id: true,
          name: true,
          code: true,
          isActive: true,
          latitude: true,
          longitude: true,
        },
      });
      for (const p of allPops) {
        if (p.latitude == null || p.longitude == null) {
          withoutGeo++;
          continue;
        }
        points.push({
          id: p.id,
          kind: 'POP',
          name: p.name,
          code: p.code,
          latitude: Number(p.latitude),
          longitude: Number(p.longitude),
          popId: null,
          isActive: p.isActive,
          vendor: null,
          model: null,
          ipAddress: null,
        });
        popsCount++;
      }
    }

    if (query.includeEquipment !== false) {
      const allEq = await this.prisma.networkEquipment.findMany({
        where: { tenantId, deletedAt: null },
        select: {
          id: true,
          name: true,
          type: true,
          vendor: true,
          ipAddress: true,
          popId: true,
          isActive: true,
          latitude: true,
          longitude: true,
        },
      });
      for (const e of allEq) {
        if (e.latitude == null || e.longitude == null) {
          withoutGeo++;
          continue;
        }
        // Mapa de NetworkEquipmentType → NetworkMapPointKind. OLT do
        // network_equipment inventory mostra "OLT" (mesmo ícone do model rico).
        const kindMap: Record<typeof e.type, NetworkMapPointKind> = {
          BNG: 'BNG',
          OLT: 'OLT',
          ROUTER: 'ROUTER',
          SWITCH: 'SWITCH',
          OTHER: 'OTHER',
        };
        points.push({
          id: e.id,
          kind: kindMap[e.type],
          name: e.name,
          code: null,
          latitude: Number(e.latitude),
          longitude: Number(e.longitude),
          popId: e.popId,
          isActive: e.isActive,
          vendor: e.vendor,
          model: null,
          ipAddress: e.ipAddress,
        });
        equipmentCount++;
      }
    }

    if (query.includeOlts !== false) {
      const allOlts = await this.prisma.olt.findMany({
        where: { tenantId, deletedAt: null },
        select: {
          id: true,
          name: true,
          vendor: true,
          model: true,
          managementIp: true,
          status: true,
          latitude: true,
          longitude: true,
        },
      });
      for (const o of allOlts) {
        if (o.latitude == null || o.longitude == null) {
          withoutGeo++;
          continue;
        }
        points.push({
          id: o.id,
          kind: 'OLT',
          name: o.name,
          code: null,
          latitude: Number(o.latitude),
          longitude: Number(o.longitude),
          popId: null,
          // OLT.status é enum próprio; considera "ativa" quando ONLINE/UNKNOWN
          // (não-OFFLINE/UNREACHABLE). Operador vê cor no mapa.
          isActive: o.status !== 'OFFLINE' && o.status !== 'UNREACHABLE',
          vendor: o.vendor,
          model: o.model,
          ipAddress: o.managementIp,
        });
        oltsCount++;
      }
    }

    if (query.includeEnclosures !== false) {
      const allEnc = await this.prisma.opticalEnclosure.findMany({
        where: { tenantId, deletedAt: null },
        select: {
          id: true,
          code: true,
          type: true,
          isActive: true,
          capacity: true,
          latitude: true,
          longitude: true,
          ports: { select: { status: true } },
        },
      });
      for (const e of allEnc) {
        if (e.latitude == null || e.longitude == null) {
          withoutGeo++;
          continue;
        }
        const used = e.ports.filter(
          (p) => p.status === 'USED' || p.status === 'RESERVED',
        ).length;
        const occupancyPct =
          e.capacity > 0 ? Math.round((used / e.capacity) * 100) : 0;
        points.push({
          id: e.id,
          kind: e.type, // enum bate com NetworkMapPointKind (CTO/NAP/SPLITTER/EMENDA)
          name: e.code,
          code: e.code,
          latitude: Number(e.latitude),
          longitude: Number(e.longitude),
          popId: null,
          isActive: e.isActive,
          vendor: null,
          model: null,
          ipAddress: null,
          capacity: e.capacity,
          occupancyPct,
        });
        enclosuresCount++;
      }
    }

    if (query.includeCables !== false) {
      const allCables = await this.prisma.fiberCable.findMany({
        where: { tenantId, deletedAt: null, isActive: true },
        select: {
          id: true,
          code: true,
          type: true,
          path: true,
          fiberCount: true,
          lengthMeters: true,
          isActive: true,
        },
      });
      for (const c of allCables) {
        // Path armazenado como [[lng, lat], ...]. Convertemos pra
        // {latitude, longitude} pro formato do app (resto do mundo).
        const path = Array.isArray(c.path)
          ? (c.path as unknown[])
              .filter(
                (p): p is [number, number] =>
                  Array.isArray(p) &&
                  typeof p[0] === 'number' &&
                  typeof p[1] === 'number',
              )
              .map(([lng, lat]) => ({ latitude: lat, longitude: lng }))
          : [];
        if (path.length < 2) {
          withoutGeo++;
          continue;
        }
        segments.push({
          id: c.id,
          code: c.code,
          type: c.type,
          path,
          fiberCount: c.fiberCount,
          lengthMeters: Number(c.lengthMeters),
          isActive: c.isActive,
        });
        cablesCount++;
      }
    }

    return {
      points,
      segments,
      stats: {
        total: points.length + segments.length,
        pops: popsCount,
        equipment: equipmentCount,
        olts: oltsCount,
        enclosures: enclosuresCount,
        cables: cablesCount,
        withoutGeo,
      },
    };
  }
}
