/**
 * AlarmScopeResolver — traduz uma ONT na sua hierarquia de topologia
 * (ONT → CTO → cabo → OLT) e conta total/afetados por escopo. É a base
 * determinística da correlação: o grafo SABE quais ONTs compartilham CTO/cabo,
 * então não é palpite — é query.
 *
 * Caminho do grafo (FiberMap / OSP v2 — models reais):
 *   Ont.contractId → Contract.fibermapPort → FibermapDevice.elementId
 *     (CTO = FibermapElement; o scopeId CTO é o id do elemento)
 *   FibermapCableSegment (from/to o elemento) → FibermapCable (cabo do traçado)
 *   Ont.oltId (OLT, sempre disponível)  ·  Contract.lat/long (geo, fallback)
 *
 * "Afetado" = ONT em status de queda (OFFLINE/LOS/FAULT — o coletor de syslog
 * mantém Ont.status). Modo degradado: onde a porta de drop não está mapeada
 * (contrato sem fibermapPortId), só os escopos OLT/PON/GEO funcionam.
 *
 * @provenance Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=
 */
import { Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

/** Status de ONT que contam como "caída" pra correlação. */
export const DOWN_STATUSES = ['OFFLINE', 'LOS', 'FAULT'] as const;

export interface OntScopeChain {
  oltId: string | null;
  ctoId: string | null;
  ctoLabel: string | null;
  cableId: string | null;
  cableLabel: string | null;
  ponSlot: number | null;
  ponFrame: number | null;
  lat: number | null;
  lng: number | null;
}

export interface ScopeStats {
  total: number;
  downCount: number;
  downOntIds: string[];
  /** Reason dominante entre as quedas (pra classificar energia × rompimento). */
  powerCount: number;
  linkCount: number;
}

@Injectable()
export class AlarmScopeResolver {
  constructor(private readonly prisma: PrismaService) {}

  /** Resolve a cadeia de escopos de uma ONT (CTO/cabo/OLT/PON/geo). */
  async chainForOnt(tenantId: string, ontId: string): Promise<OntScopeChain | null> {
    const ont = await this.prisma.ont.findFirst({
      where: { id: ontId, tenantId },
      select: {
        oltId: true,
        ponSlot: true,
        ponFrame: true,
        contract: {
          select: {
            latitude: true,
            longitude: true,
            fibermapPort: {
              select: {
                device: {
                  select: {
                    element: {
                      select: {
                        id: true,
                        name: true,
                        // Cabo do traçado que chega/sai da caixa (segmentos).
                        // Se mais de um cabo toca o elemento, a escolha é
                        // determinística (cableId asc) — suficiente pra
                        // correlacionar rompimento.
                        segmentsTo: {
                          where: { cable: { deletedAt: null } },
                          orderBy: { cableId: 'asc' },
                          take: 1,
                          select: { cableId: true, cable: { select: { name: true } } },
                        },
                        segmentsFrom: {
                          where: { cable: { deletedAt: null } },
                          orderBy: { cableId: 'asc' },
                          take: 1,
                          select: { cableId: true, cable: { select: { name: true } } },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!ont) return null;

    const el = ont.contract?.fibermapPort?.device.element ?? null;
    const seg = el ? (el.segmentsTo[0] ?? el.segmentsFrom[0] ?? null) : null;
    return {
      oltId: ont.oltId,
      ctoId: el?.id ?? null,
      ctoLabel: el?.name ?? null,
      cableId: seg?.cableId ?? null,
      cableLabel: seg?.cable.name ?? null,
      ponSlot: ont.ponSlot,
      ponFrame: ont.ponFrame,
      lat: ont.contract?.latitude != null ? Number(ont.contract.latitude) : null,
      lng: ont.contract?.longitude != null ? Number(ont.contract.longitude) : null,
    };
  }

  /** ONTs de uma CTO (FibermapElement → devices → portas de drop → contratos → ONTs). */
  async statsCto(tenantId: string, ctoId: string, reasonSince: Date): Promise<ScopeStats> {
    return this.statsFromWhere(
      tenantId,
      { contract: { fibermapPort: { device: { elementId: ctoId } } } },
      reasonSince,
    );
  }

  /** ONTs de um cabo (segmentos do cabo → elementos tocados → portas → contratos → ONTs). */
  async statsCable(tenantId: string, cableId: string, reasonSince: Date): Promise<ScopeStats> {
    return this.statsFromWhere(
      tenantId,
      {
        contract: {
          fibermapPort: {
            device: {
              element: {
                OR: [
                  { segmentsFrom: { some: { cableId } } },
                  { segmentsTo: { some: { cableId } } },
                ],
              },
            },
          },
        },
      },
      reasonSince,
    );
  }

  /** ONTs da mesma PON física (oltId + slot + frame — sempre disponível na Ont). */
  async statsPon(
    tenantId: string,
    oltId: string,
    ponSlot: number,
    ponFrame: number,
    reasonSince: Date,
  ): Promise<ScopeStats> {
    return this.statsFromWhere(tenantId, { oltId, ponSlot, ponFrame }, reasonSince);
  }

  /** ONTs de uma OLT inteira. */
  async statsOlt(tenantId: string, oltId: string, reasonSince: Date): Promise<ScopeStats> {
    return this.statsFromWhere(tenantId, { oltId }, reasonSince);
  }

  /** Helper genérico: conta total/afetados + tally de reason num conjunto de ONTs. */
  private async statsFromWhere(
    tenantId: string,
    where: Record<string, unknown>,
    reasonSince: Date,
  ): Promise<ScopeStats> {
    const onts = await this.prisma.ont.findMany({
      where: { tenantId, ...where },
      select: { id: true, status: true },
    });
    const downOntIds = onts
      .filter((o) => (DOWN_STATUSES as readonly string[]).includes(o.status))
      .map((o) => o.id);

    let powerCount = 0;
    let linkCount = 0;
    if (downOntIds.length) {
      // Reason mais recente por ONT na janela (POWER_LOSS=dying-gasp / LINK_LOSS=LOS).
      const events = await this.prisma.alarmEvent.findMany({
        where: { tenantId, ontId: { in: downOntIds }, kind: 'DOWN', at: { gte: reasonSince } },
        orderBy: { at: 'desc' },
        select: { ontId: true, reason: true },
      });
      const seen = new Set<string>();
      for (const e of events) {
        if (!e.ontId || seen.has(e.ontId)) continue;
        seen.add(e.ontId);
        if (e.reason === 'POWER_LOSS') powerCount++;
        else if (e.reason === 'LINK_LOSS') linkCount++;
      }
    }
    return { total: onts.length, downCount: downOntIds.length, downOntIds, powerCount, linkCount };
  }
}
