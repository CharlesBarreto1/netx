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

    // ── Stats: contamos "withoutGeo" por tipo, separado da response principal.
    let popsCount = 0;
    let equipmentCount = 0;
    let oltsCount = 0;
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

    return {
      points,
      stats: {
        total: points.length,
        pops: popsCount,
        equipment: equipmentCount,
        olts: oltsCount,
        withoutGeo,
      },
    };
  }
}
