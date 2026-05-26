/**
 * PonTreeService — traversal do grafo óptico em árvore (R7 OSP).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Doc: docs/architecture/osp-network.md
 *
 * Algoritmo:
 *   1. Carrega TODAS as caixas + cabos + ports + eventos ativos do tenant
 *      (1 query batch cada — escala bem até dezenas de milhares de itens).
 *   2. Constrói map enclosureId → outgoingCables (endpointA == id).
 *   3. BFS recursivo a partir da raiz; visited set detecta ciclos.
 *   4. Limita profundidade em 20 níveis (FTTH real raramente passa de 10).
 *
 * Resultado: nó raiz com nós filhos aninhados via cables[].destination.
 * Frontend renderiza em SVG top-down (componente PonTreeView).
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  PonTreeCable,
  PonTreeNode,
  PonTreeResponse,
  PonTreeRootCandidate,
} from '@netx/shared';

import { PrismaService } from '../prisma/prisma.service';

const MAX_DEPTH = 20;

@Injectable()
export class PonTreeService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lista caixas que SÃO raízes naturais (ninguém aponta cabo pra elas como
   * endpointB). Sempre lista também TODAS as caixas pra operador escolher
   * raiz custom se quiser (ex: ver árvore a partir de uma CTO no meio).
   */
  async listRootCandidates(tenantId: string): Promise<PonTreeRootCandidate[]> {
    const enclosures = await this.prisma.opticalEnclosure.findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true, code: true, type: true },
      orderBy: { code: 'asc' },
    });
    // Cabos onde a caixa É endpointB → ela está "abaixo" de outra.
    const targets = await this.prisma.fiberCable.findMany({
      where: { tenantId, deletedAt: null, endpointBId: { not: null } },
      select: { endpointBId: true },
    });
    const hasIncoming = new Set(
      targets.map((t) => t.endpointBId).filter((id): id is string => !!id),
    );
    // Outgoing count pra cada caixa pra mostrar "(N saídas)" na UI.
    const outgoing = await this.prisma.fiberCable.groupBy({
      by: ['endpointAId'],
      where: { tenantId, deletedAt: null, endpointAId: { not: null } },
      _count: true,
    });
    const outMap = new Map<string, number>();
    for (const o of outgoing) {
      if (o.endpointAId) outMap.set(o.endpointAId, o._count);
    }
    return enclosures.map((e) => ({
      id: e.id,
      code: e.code,
      type: e.type,
      isRootCandidate: !hasIncoming.has(e.id),
      outgoingCableCount: outMap.get(e.id) ?? 0,
    }));
  }

  /**
   * Monta a árvore a partir de uma caixa raiz. Pré-carrega tudo em batch
   * pra evitar N+1 queries durante o traversal.
   */
  async buildTree(
    tenantId: string,
    rootEnclosureId: string,
  ): Promise<PonTreeResponse> {
    const root = await this.prisma.opticalEnclosure.findFirst({
      where: { id: rootEnclosureId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!root) throw new NotFoundException('Caixa raiz não encontrada');

    // Batch loads.
    const [enclosures, cables, ports, activeEvents] = await Promise.all([
      this.prisma.opticalEnclosure.findMany({
        where: { tenantId, deletedAt: null },
        select: {
          id: true,
          code: true,
          type: true,
          splitterRatio: true,
          capacity: true,
        },
      }),
      this.prisma.fiberCable.findMany({
        where: { tenantId, deletedAt: null },
        select: {
          id: true,
          code: true,
          type: true,
          fiberCount: true,
          lengthMeters: true,
          endpointAId: true,
          endpointBId: true,
        },
      }),
      this.prisma.opticalPort.groupBy({
        by: ['enclosureId', 'status'],
        where: { tenantId },
        _count: true,
      }),
      this.prisma.fiberEvent.groupBy({
        by: ['cableId'],
        where: { tenantId, deletedAt: null, resolvedAt: null },
        _count: true,
      }),
    ]);

    // Maps pra lookup O(1).
    const enclosuresById = new Map(enclosures.map((e) => [e.id, e]));
    const cablesByEndpointA = new Map<string, typeof cables>();
    for (const c of cables) {
      if (!c.endpointAId) continue;
      const arr = cablesByEndpointA.get(c.endpointAId) ?? [];
      arr.push(c);
      cablesByEndpointA.set(c.endpointAId, arr);
    }
    // Ports usados/total por enclosure.
    const portStats = new Map<
      string,
      { total: number; used: number }
    >();
    for (const e of enclosures) {
      portStats.set(e.id, { total: 0, used: 0 });
    }
    for (const p of ports) {
      const stat = portStats.get(p.enclosureId);
      if (!stat) continue;
      stat.total += p._count;
      if (p.status === 'USED' || p.status === 'RESERVED') {
        stat.used += p._count;
      }
    }
    // Active events count por cabo.
    const eventsByCable = new Map<string, number>();
    for (const e of activeEvents) {
      eventsByCable.set(e.cableId, e._count);
    }

    // Estatísticas globais durante o traversal.
    let totalNodes = 0;
    let totalCables = 0;
    let leafClients = 0;
    let maxDepth = 0;

    function buildNode(
      enclosureId: string,
      depth: number,
      visited: Set<string>,
    ): PonTreeNode | null {
      const e = enclosuresById.get(enclosureId);
      if (!e) return null;
      totalNodes++;
      if (depth > maxDepth) maxDepth = depth;
      const stat = portStats.get(enclosureId) ?? { total: 0, used: 0 };

      const cablesOut = cablesByEndpointA.get(enclosureId) ?? [];
      const outgoingCables: PonTreeCable[] = cablesOut.map((c) => {
        totalCables++;
        const activeEventsCount = eventsByCable.get(c.id) ?? 0;

        let destination: PonTreeNode | null = null;
        let cycleToEnclosureId: string | undefined;
        if (c.endpointBId) {
          if (visited.has(c.endpointBId)) {
            // Já visitamos esta caixa em outro caminho → ciclo.
            cycleToEnclosureId = c.endpointBId;
          } else if (depth + 1 > MAX_DEPTH) {
            // Cortado por limite — exclamation visual na UI.
            cycleToEnclosureId = c.endpointBId;
          } else {
            const nextVisited = new Set(visited);
            nextVisited.add(c.endpointBId);
            destination = buildNode(c.endpointBId, depth + 1, nextVisited);
          }
        }
        if (!destination) {
          // Cabo termina sem destination → conta como leaf client (drop pra
          // ONT presumivelmente).
          if (c.type === 'DROP') leafClients++;
        }
        return {
          id: c.id,
          code: c.code,
          type: c.type,
          fiberCount: c.fiberCount,
          lengthMeters: Number(c.lengthMeters),
          destination,
          cycleToEnclosureId,
          activeEventsCount,
        };
      });

      return {
        enclosure: {
          id: e.id,
          code: e.code,
          type: e.type,
          splitterRatio: e.splitterRatio,
          capacity: e.capacity,
          portsUsed: stat.used,
          portsTotal: stat.total,
        },
        outgoingCables,
      };
    }

    const visited = new Set<string>();
    visited.add(rootEnclosureId);
    const tree = buildNode(rootEnclosureId, 0, visited);
    if (!tree) {
      throw new NotFoundException('Falha ao montar árvore (caixa inválida)');
    }

    return {
      root: tree,
      stats: { totalNodes, totalCables, leafClients, maxDepth },
    };
  }
}
