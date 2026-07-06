/**
 * FibermapPowerBudgetService — orçamento de potência (FM-6, spec §5.4).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Reusa o trace da porta (FM-4) e delega a matemática ao power-budget.ts
 * puro; aqui só a comparação esperado × medido: a medição MAIS RECENTE de
 * cada porta na MESMA λ (fibermap_power_measurements — manual hoje, SNMP no
 * Pilar 2) é anexada aos eventos e terminais com o delta.
 */
import { Injectable } from '@nestjs/common';
import type {
  FibermapPowerBudgetEvent,
  FibermapPowerBudgetQuery,
  FibermapPowerBudgetResponse,
  FibermapTraceWavelength,
} from '@netx/shared';

import { PrismaService } from '../prisma/prisma.service';
import { FibermapConnectivityGraphService } from './connectivity-graph.service';
import { buildPowerBudget } from './power-budget';

const round2 = (v: number): number => Math.round(v * 100) / 100;

@Injectable()
export class FibermapPowerBudgetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly graph: FibermapConnectivityGraphService,
  ) {}

  async budget(
    tenantId: string,
    portId: string,
    q: FibermapPowerBudgetQuery,
  ): Promise<FibermapPowerBudgetResponse> {
    // Valida a porta e carrega o componente (404/400 amigáveis lá dentro).
    const trace = await this.graph.tracePort(tenantId, portId, {
      wavelength: q.wavelength as FibermapTraceWavelength,
    });
    const built = buildPowerBudget(trace.path, {
      txDbm: q.txDbm,
      warnDbm: q.warnDbm,
      critDbm: q.critDbm,
    });

    // ── Esperado × medido: última medição por porta na MESMA λ ────────────
    const portIds = new Set<string>();
    const collect = (events: FibermapPowerBudgetEvent[]): void => {
      for (const ev of events) {
        if (ev.portId) portIds.add(ev.portId);
        if (ev.branches) for (const b of ev.branches) collect(b.events);
      }
    };
    collect(built.path);

    if (portIds.size > 0) {
      const rows = await this.prisma.fibermapPowerMeasurement.findMany({
        where: {
          tenantId,
          wavelengthNm: q.wavelength,
          portId: { in: [...portIds] },
        },
        orderBy: { measuredAt: 'desc' },
        select: { portId: true, dbm: true, measuredAt: true },
      });
      const latest = new Map<string, { dbm: number; at: string }>();
      for (const r of rows) {
        if (r.portId && !latest.has(r.portId)) {
          latest.set(r.portId, { dbm: Number(r.dbm), at: r.measuredAt.toISOString() });
        }
      }
      if (latest.size > 0) {
        const annotate = (events: FibermapPowerBudgetEvent[]): void => {
          for (const ev of events) {
            const m = ev.portId ? latest.get(ev.portId) : undefined;
            if (m) {
              ev.measuredDbm = m.dbm;
              ev.measuredAt = m.at;
              ev.deltaDb = round2(m.dbm - ev.expectedDbm);
            }
            if (ev.branches) for (const b of ev.branches) annotate(b.events);
          }
        };
        annotate(built.path);
        for (const t of built.terminals) {
          const m = t.portId ? latest.get(t.portId) : undefined;
          if (m) {
            t.measuredDbm = m.dbm;
            t.deltaDb = round2(m.dbm - t.expectedDbm);
          }
        }
      }
    }

    return {
      wavelengthNm: q.wavelength,
      txDbm: q.txDbm,
      warnDbm: q.warnDbm,
      critDbm: q.critDbm,
      origin: trace.origin,
      path: built.path,
      terminals: built.terminals,
      worstDbm: built.worstDbm,
      maxDistanceM: trace.maxDistanceM,
    };
  }
}
