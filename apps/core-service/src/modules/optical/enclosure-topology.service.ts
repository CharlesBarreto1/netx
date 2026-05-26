/**
 * EnclosureTopologyService — snapshot agregado de uma caixa óptica (R4.5a).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Doc: docs/architecture/osp-network.md
 *
 * GET /v1/optical/enclosures/:id/topology junta em UM request tudo que a
 * vista esquemática (R4.5b) precisa renderizar — caixa, splitters filhos,
 * cabos entrando, fusões dentro e portas com contratos.
 *
 * Sem N+1: 4 queries em paralelo + 1 query final pros contratos das portas.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import {
  classifyLoss,
  fiberColor,
  type EnclosureTopologyResponse,
  type TopologyCable,
  type TopologyChildSplitter,
  type TopologyPort,
  type TopologySplice,
} from '@netx/shared';

import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class EnclosureTopologyService {
  constructor(private readonly prisma: PrismaService) {}

  async getTopology(
    tenantId: string,
    enclosureId: string,
  ): Promise<EnclosureTopologyResponse> {
    const enclosure = await this.prisma.opticalEnclosure.findFirst({
      where: { id: enclosureId, tenantId, deletedAt: null },
      select: {
        id: true,
        code: true,
        type: true,
        latitude: true,
        longitude: true,
        capacity: true,
        splitterRatio: true,
      },
    });
    if (!enclosure) throw new NotFoundException('Caixa não encontrada');

    // 4 queries paralelas — cada uma resolve uma sessão da vista esquemática.
    const [childrenRows, cablesA, cablesB, ports] = await Promise.all([
      this.prisma.opticalEnclosure.findMany({
        where: {
          tenantId,
          parentId: enclosureId,
          deletedAt: null,
          type: 'SPLITTER',
        },
        select: {
          id: true,
          code: true,
          splitterRatio: true,
          capacity: true,
          ports: { select: { status: true } },
        },
      }),
      this.prisma.fiberCable.findMany({
        where: { tenantId, endpointAId: enclosureId, deletedAt: null },
        select: {
          id: true,
          code: true,
          type: true,
          fiberCount: true,
          lengthMeters: true,
          endpointB: { select: { id: true, code: true } },
        },
      }),
      this.prisma.fiberCable.findMany({
        where: { tenantId, endpointBId: enclosureId, deletedAt: null },
        select: {
          id: true,
          code: true,
          type: true,
          fiberCount: true,
          lengthMeters: true,
          endpointA: { select: { id: true, code: true } },
        },
      }),
      this.prisma.opticalPort.findMany({
        where: { tenantId, enclosureId },
        select: {
          id: true,
          number: true,
          status: true,
          contract: {
            select: {
              id: true,
              code: true,
              customer: { select: { displayName: true } },
            },
          },
        },
        orderBy: { number: 'asc' },
      }),
    ]);

    const childSplitters: TopologyChildSplitter[] = childrenRows.map((c) => ({
      id: c.id,
      code: c.code,
      type: 'SPLITTER',
      splitterRatio: c.splitterRatio,
      capacity: c.capacity,
      portsTotal: c.capacity,
      portsUsed: c.ports.filter(
        (p) => p.status === 'USED' || p.status === 'RESERVED',
      ).length,
    }));

    const incomingCables: TopologyCable[] = [
      ...cablesA.map<TopologyCable>((c) => ({
        id: c.id,
        code: c.code,
        type: c.type,
        fiberCount: c.fiberCount,
        endpointRole: 'A',
        otherEndpointId: c.endpointB?.id ?? null,
        otherEndpointCode: c.endpointB?.code ?? null,
        lengthMeters: Number(c.lengthMeters),
      })),
      ...cablesB.map<TopologyCable>((c) => ({
        id: c.id,
        code: c.code,
        type: c.type,
        fiberCount: c.fiberCount,
        endpointRole: 'B',
        otherEndpointId: c.endpointA?.id ?? null,
        otherEndpointCode: c.endpointA?.code ?? null,
        lengthMeters: Number(c.lengthMeters),
      })),
    ];

    // Fusões "dentro" desta caixa: aquelas que envolvem QUALQUER cabo
    // que termina aqui — i.e. ambos os lados são cabos de incomingCables.
    const cableIds = incomingCables.map((c) => c.id);
    const splicesRaw = cableIds.length
      ? await this.prisma.fiberSplice.findMany({
          where: {
            tenantId,
            deletedAt: null,
            OR: [
              { cableAId: { in: cableIds } },
              { cableBId: { in: cableIds } },
            ],
          },
          select: {
            id: true,
            fiberAIndex: true,
            fiberBIndex: true,
            lossDb: true,
            cableA: { select: { id: true, code: true } },
            cableB: { select: { id: true, code: true } },
          },
        })
      : [];

    const splices: TopologySplice[] = splicesRaw.map((s) => {
      const lossDb = s.lossDb != null ? Number(s.lossDb) : null;
      return {
        id: s.id,
        cableAId: s.cableA.id,
        cableACode: s.cableA.code,
        fiberAIndex: s.fiberAIndex,
        fiberAColorHex: fiberColor(s.fiberAIndex).hex,
        cableBId: s.cableB.id,
        cableBCode: s.cableB.code,
        fiberBIndex: s.fiberBIndex,
        fiberBColorHex: fiberColor(s.fiberBIndex).hex,
        lossDb,
        lossClass: classifyLoss(lossDb),
      };
    });

    const portsOut: TopologyPort[] = ports.map((p) => ({
      id: p.id,
      number: p.number,
      status: p.status,
      contract: p.contract
        ? {
            id: p.contract.id,
            code: p.contract.code,
            customerDisplayName: p.contract.customer.displayName,
          }
        : null,
    }));

    return {
      enclosure: {
        id: enclosure.id,
        code: enclosure.code,
        type: enclosure.type,
        latitude: Number(enclosure.latitude),
        longitude: Number(enclosure.longitude),
        capacity: enclosure.capacity,
        splitterRatio: enclosure.splitterRatio,
      },
      childSplitters,
      incomingCables,
      splices,
      ports: portsOut,
    };
  }
}
