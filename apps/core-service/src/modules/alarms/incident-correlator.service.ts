/**
 * IncidentCorrelator — o motor determinístico da Central de Alarmes.
 *
 * Pra cada evento de queda/retorno de ONT, resolve os escopos da topologia
 * (CTO/cabo/OLT/PON/geo), conta % afetado em cada um, e abre/atualiza UM
 * Incident no escopo de MAIOR impacto que bate o limiar do tenant — é assim
 * que "4 caixas do mesmo cabo caídas" viram 1 alarme de rompimento em vez de 4.
 * Incidents de escopo menor que pertencem ao primário são suprimidos
 * (parentIncidentId). Classifica energia × rompimento pela mistura de reason
 * (POWER_LOSS=dying-gasp vs LINK_LOSS=LOS).
 *
 * Chamado in-process pelo OltSyslogCollector (best-effort, fora do caminho
 * crítico). Sem timers: usa Ont.status (mantido pelo coletor) como estado
 * atual, então cada evento reavalia o estado real — a "janela" some porque a
 * agregação é find-or-create por (escopo, ref).
 *
 * @provenance Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=
 */
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

import { AlarmNotifier } from './alarm-notifier.service';
import {
  AlarmScopeResolver,
  type OntScopeChain,
  type ScopeStats,
  DOWN_STATUSES,
} from './alarm-scope.resolver';
import { AlarmStream } from './alarm-stream.service';
import { IncidentAiService } from './incident-ai.service';

type ScopeName = 'OLT' | 'CABLE' | 'CTO' | 'PON' | 'GEO';
type RootCause = 'POWER_OUTAGE' | 'FIBER_CUT' | 'OPTICAL_DEGRADED' | 'ISOLATED' | 'UNKNOWN';
type Severity = 'INFO' | 'WARNING' | 'CRITICAL';

interface ResolvedPolicy {
  ctoPct: number;
  ctoMin: number;
  ponPct: number;
  ponMin: number;
  cablePct: number;
  cableMin: number;
  oltMin: number;
  geoMin: number;
  severityMap: Record<string, Severity>;
}

interface Candidate {
  scope: ScopeName;
  refId: string | null;
  label: string;
  stats: ScopeStats;
  breaches: boolean;
}

/** Raio (m) pra agrupar quedas de energia num "bairro" (escopo GEO). */
const GEO_RADIUS_M = 400;
/** Janela pra tally de reason e cluster geo. */
const REASON_WINDOW_MS = 15 * 60 * 1000;

const DEFAULT_SEVERITY: Record<RootCause, Severity> = {
  FIBER_CUT: 'CRITICAL',
  POWER_OUTAGE: 'WARNING',
  OPTICAL_DEGRADED: 'INFO',
  ISOLATED: 'INFO',
  UNKNOWN: 'WARNING',
};

@Injectable()
export class IncidentCorrelator {
  private readonly logger = new Logger(IncidentCorrelator.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scopes: AlarmScopeResolver,
    private readonly stream: AlarmStream,
    private readonly ai: IncidentAiService,
    private readonly notifier: AlarmNotifier,
  ) {}

  /** Ponto de entrada — chamado pelo coletor após gravar o AlarmEvent. */
  async ingest(input: {
    tenantId: string;
    ontId: string;
    eventId?: string;
    kind: 'DOWN' | 'UP' | 'DEGRADED';
    at: Date;
  }): Promise<void> {
    try {
      const chain = await this.scopes.chainForOnt(input.tenantId, input.ontId);
      if (!chain) return;
      const policy = await this.loadPolicy(input.tenantId);
      const since = new Date(input.at.getTime() - REASON_WINDOW_MS);

      const candidates = await this.buildCandidates(input.tenantId, chain, policy, since);
      const breaching = candidates.filter((c) => c.breaches);

      if (breaching.length === 0) {
        // Nada bate o limiar — se foi um retorno (UP), pode resolver incidents
        // cujo nº de afetados caiu abaixo do mínimo.
        await this.autoResolve(input.tenantId, candidates);
        return;
      }

      // Primário = maior impacto (mais clientes afetados); desempate por amplitude.
      const primary = breaching.sort(
        (a, b) => b.stats.downCount - a.stats.downCount || breadth(b.scope) - breadth(a.scope),
      )[0];

      const { incident, created } = await this.openOrUpdate(input.tenantId, primary, input.at);
      if (input.eventId) {
        await this.prisma.alarmEvent
          .update({ where: { id: input.eventId }, data: { incidentId: incident.id } })
          .catch(() => undefined);
      }
      await this.suppressChildren(input.tenantId, primary, incident.id);
      await this.autoResolve(input.tenantId, candidates, incident.id);

      // Fase 3 — real-time pro painel/mobile.
      this.stream.publish(input.tenantId, 'incident', incident);
      if (created) {
        // Fase 4 — enriquecimento por IA (assíncrono, best-effort).
        void this.ai.enrich(incident.id);
        if (incident.severity === 'CRITICAL') {
          void this.notifier.notifyCritical({
            tenantId: input.tenantId,
            incidentId: incident.id,
            title: `Alarme crítico — ${incident.scopeLabel}`,
            body: `${incident.affectedCount} clientes afetados (${incident.rootCause}).`,
          });
        }
      }
    } catch (err) {
      this.logger.warn(
        `[correlator] ingest falhou ont=${input.ontId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  // ───────────────────────────────────────────────────────────────────────

  private async buildCandidates(
    tenantId: string,
    chain: OntScopeChain,
    policy: ResolvedPolicy,
    since: Date,
  ): Promise<Candidate[]> {
    const out: Candidate[] = [];
    const pct = (s: ScopeStats) => (s.total > 0 ? (s.downCount / s.total) * 100 : 0);

    if (chain.oltId) {
      const stats = await this.scopes.statsOlt(tenantId, chain.oltId, since);
      out.push({
        scope: 'OLT',
        refId: chain.oltId,
        label: `OLT ${chain.oltId.slice(0, 8)}`,
        stats,
        breaches: stats.downCount >= policy.oltMin,
      });
    }
    if (chain.cableId) {
      const stats = await this.scopes.statsCable(tenantId, chain.cableId, since);
      out.push({
        scope: 'CABLE',
        refId: chain.cableId,
        label: `Cabo ${chain.cableLabel ?? chain.cableId.slice(0, 8)}`,
        stats,
        breaches: stats.downCount >= policy.cableMin && pct(stats) >= policy.cablePct,
      });
    }
    if (chain.ctoId) {
      const stats = await this.scopes.statsCto(tenantId, chain.ctoId, since);
      out.push({
        scope: 'CTO',
        refId: chain.ctoId,
        label: chain.ctoLabel ?? `CTO ${chain.ctoId.slice(0, 8)}`,
        stats,
        breaches: stats.downCount >= policy.ctoMin && pct(stats) >= policy.ctoPct,
      });
    }
    if (chain.oltId && chain.ponSlot != null && chain.ponFrame != null) {
      const stats = await this.scopes.statsPon(
        tenantId,
        chain.oltId,
        chain.ponSlot,
        chain.ponFrame,
        since,
      );
      out.push({
        scope: 'PON',
        refId: null,
        label: `PON ${chain.ponSlot}/${chain.ponFrame}`,
        stats,
        breaches: stats.downCount >= policy.ponMin && pct(stats) >= policy.ponPct,
      });
    }
    // GEO — agrupa quedas por proximidade (marca queda de energia no bairro).
    if (chain.lat != null && chain.lng != null) {
      const geo = await this.geoStats(tenantId, chain.lat, chain.lng, since);
      out.push({
        scope: 'GEO',
        refId: null,
        label: `Área ~${chain.lat.toFixed(3)},${chain.lng.toFixed(3)}`,
        stats: geo,
        breaches: geo.downCount >= policy.geoMin,
      });
    }
    return out;
  }

  /** Quedas dentro de GEO_RADIUS_M do ponto (haversine app-side; conjunto pequeno). */
  private async geoStats(
    tenantId: string,
    lat: number,
    lng: number,
    since: Date,
  ): Promise<ScopeStats> {
    const downs = await this.prisma.ont.findMany({
      where: {
        tenantId,
        status: { in: [...DOWN_STATUSES] },
        contract: { latitude: { not: null }, longitude: { not: null } },
      },
      select: { id: true, contract: { select: { latitude: true, longitude: true } } },
    });
    const near = downs.filter((o) => {
      const la = o.contract?.latitude != null ? Number(o.contract.latitude) : null;
      const lo = o.contract?.longitude != null ? Number(o.contract.longitude) : null;
      return la != null && lo != null && haversineM(lat, lng, la, lo) <= GEO_RADIUS_M;
    });
    const downOntIds = near.map((o) => o.id);
    let powerCount = 0;
    let linkCount = 0;
    if (downOntIds.length) {
      const events = await this.prisma.alarmEvent.findMany({
        where: { tenantId, ontId: { in: downOntIds }, kind: 'DOWN', at: { gte: since } },
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
    // total não é bem-definido pra geo; usamos downCount (pct não se aplica).
    return { total: downOntIds.length, downCount: downOntIds.length, downOntIds, powerCount, linkCount };
  }

  private classify(stats: ScopeStats): RootCause {
    if (stats.downCount <= 1) return 'ISOLATED';
    if (stats.powerCount === 0 && stats.linkCount === 0) return 'UNKNOWN';
    return stats.powerCount >= stats.linkCount ? 'POWER_OUTAGE' : 'FIBER_CUT';
  }

  private severityFor(policy: ResolvedPolicy, cause: RootCause): Severity {
    return policy.severityMap[cause] ?? DEFAULT_SEVERITY[cause];
  }

  private async openOrUpdate(tenantId: string, c: Candidate, at: Date) {
    const cause = this.classify(c.stats);
    const policy = await this.loadPolicy(tenantId);
    const severity = this.severityFor(policy, cause);
    const affectedPct = new Prisma.Decimal(
      c.stats.total > 0 ? (c.stats.downCount / c.stats.total) * 100 : 0,
    ).toDecimalPlaces(2);

    // GEO casa por label (centroide arredondado); demais por refId.
    const existing = await this.prisma.incident.findFirst({
      where: {
        tenantId,
        scope: c.scope,
        status: { in: ['OPEN', 'ACK'] },
        ...(c.scope === 'GEO' ? { scopeLabel: c.label } : { scopeRefId: c.refId }),
      },
      select: { id: true },
    });

    if (existing) {
      const incident = await this.prisma.incident.update({
        where: { id: existing.id },
        data: {
          affectedCount: c.stats.downCount,
          totalInScope: c.stats.total,
          affectedPct,
          rootCause: cause,
          severity,
          lastEventAt: at,
        },
      });
      return { incident, created: false };
    }
    this.logger.log(
      `[correlator] NOVO incidente ${c.scope} "${c.label}" — ${c.stats.downCount}/${c.stats.total} (${cause})`,
    );
    const incident = await this.prisma.incident.create({
      data: {
        tenantId,
        scope: c.scope,
        scopeRefId: c.refId,
        scopeLabel: c.label,
        severity,
        rootCause: cause,
        affectedCount: c.stats.downCount,
        totalInScope: c.stats.total,
        affectedPct,
        firstEventAt: at,
        lastEventAt: at,
      },
    });
    return { incident, created: true };
  }

  /**
   * Suprime incidents de escopo MENOR que pertencem ao primário (escalonamento:
   * uma queda que começou como CTO vira rompimento de cabo → a CTO vira filha).
   * Aproxima por OLT: incidents OPEN de escopo mais estreito na mesma OLT.
   */
  private async suppressChildren(tenantId: string, primary: Candidate, parentId: string): Promise<void> {
    if (primary.scope !== 'CABLE' && primary.scope !== 'OLT' && primary.scope !== 'GEO') return;
    const narrower: ScopeName[] = primary.scope === 'OLT' ? ['CABLE', 'CTO', 'PON'] : ['CTO', 'PON'];
    await this.prisma.incident.updateMany({
      where: {
        tenantId,
        status: { in: ['OPEN', 'ACK'] },
        scope: { in: narrower },
        parentIncidentId: null,
        id: { not: parentId },
      },
      data: { parentIncidentId: parentId },
    });
  }

  /** Resolve incidents cujos afetados voltaram (downCount abaixo do mínimo). */
  private async autoResolve(
    tenantId: string,
    candidates: Candidate[],
    keepOpenId?: string,
  ): Promise<void> {
    for (const c of candidates) {
      if (c.breaches) continue;
      const where: Prisma.IncidentWhereInput = {
        tenantId,
        scope: c.scope,
        status: { in: ['OPEN', 'ACK'] },
        ...(c.scope === 'GEO' ? { scopeLabel: c.label } : { scopeRefId: c.refId }),
      };
      const open = await this.prisma.incident.findFirst({ where, select: { id: true } });
      if (open && open.id !== keepOpenId) {
        await this.prisma.incident.update({
          where: { id: open.id },
          data: { status: 'RESOLVED', resolvedAt: new Date(), affectedCount: c.stats.downCount },
        });
        this.logger.log(`[correlator] resolvido incidente ${c.scope} "${c.label}"`);
      }
    }
  }

  private async loadPolicy(tenantId: string): Promise<ResolvedPolicy> {
    const p = await this.prisma.alarmPolicy.findUnique({ where: { tenantId } });
    const sev = (p?.severityMap as Record<string, Severity> | null) ?? {};
    return {
      ctoPct: p?.ctoPctThreshold ?? 60,
      ctoMin: p?.ctoMinCount ?? 3,
      ponPct: p?.ponPctThreshold ?? 50,
      ponMin: p?.ponMinCount ?? 4,
      cablePct: p?.cablePctThreshold ?? 50,
      cableMin: p?.cableMinCount ?? 2,
      oltMin: p?.oltMinCount ?? 10,
      geoMin: p?.geoMinCount ?? 5,
      severityMap: sev,
    };
  }
}

/** Amplitude do escopo pra desempate (maior = mais amplo). */
function breadth(scope: ScopeName): number {
  return { ONT: 0, PON: 1, CTO: 2, GEO: 3, CABLE: 4, OLT: 5 }[scope] ?? 0;
}

/** Distância em metros (haversine). */
function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
