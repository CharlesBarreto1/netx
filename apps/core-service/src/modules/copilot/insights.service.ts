/**
 * InsightsService — proatividade do copiloto. Detectores determinísticos
 * (thresholds, 0 token) rodam por cron em cada tenant e geram AiInsight, que o
 * Nexus mostra como alerta. A IA é conselheira: alerta + sugere; humano decide.
 *
 * Dedupe por (tenantId, dedupeKey): cada condição/período gera UM alerta — não
 * spamma a cada execução do cron.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { AiInsightSeverity } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

// Thresholds (ajustáveis). Inadimplência/churn relativos; OS/incidente absolutos.
const INAD_WARN = 0.1; // 10% do MRR vencido
const INAD_CRIT = 0.2;
const CHURN_WARN = 0.03; // 3%/mês
const CHURN_CRIT = 0.06;
const OS_ATRASADAS_WARN = 5;
const INCIDENT_AFETADOS = 10;

function n(v: unknown): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}
function ym(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function ymd(): string {
  return new Date().toISOString().slice(0, 10);
}

interface Candidate {
  kind: string;
  dedupeKey: string;
  severity: AiInsightSeverity;
  title: string;
  body: string;
}

@Injectable()
export class InsightsService {
  private readonly logger = new Logger(InsightsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Alertas abertos (NEW) do tenant, pro Nexus. */
  list(tenantId: string) {
    return this.prisma.aiInsight.findMany({
      where: { tenantId, status: 'NEW' },
      orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
      take: 20,
      select: { id: true, kind: true, severity: true, title: true, body: true, createdAt: true },
    });
  }

  async dismiss(tenantId: string, id: string): Promise<{ ok: boolean }> {
    await this.prisma.aiInsight.updateMany({
      where: { id, tenantId },
      data: { status: 'DISMISSED', dismissedAt: new Date() },
    });
    return { ok: true };
  }

  /** Cron horário — dedupe controla a frequência real por tipo. */
  @Cron(CronExpression.EVERY_HOUR)
  async scanAll(): Promise<void> {
    const tenants = await this.prisma.tenant.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, slug: true },
    });
    for (const t of tenants) {
      try {
        await this.scanTenant(t.id);
      } catch (err) {
        this.logger.warn(`insights scan ${t.slug} falhou: ${String(err)}`);
      }
    }
  }

  /** Roda os detectores de um tenant e persiste o que disparar (idempotente). */
  async scanTenant(tenantId: string): Promise<number> {
    const candidates = await this.detect(tenantId);
    let created = 0;
    for (const c of candidates) {
      const res = await this.prisma.aiInsight.upsert({
        where: { tenantId_dedupeKey: { tenantId, dedupeKey: c.dedupeKey } },
        create: {
          tenantId,
          kind: c.kind,
          dedupeKey: c.dedupeKey,
          severity: c.severity,
          title: c.title,
          body: c.body,
        },
        update: {}, // já existe → não recria (evita spam)
        select: { createdAt: true },
      });
      // contagem aproximada (upsert não diz se criou); ok para log
      if (Date.now() - res.createdAt.getTime() < 5000) created += 1;
    }
    return created;
  }

  private async detect(tenantId: string): Promise<Candidate[]> {
    const now = new Date();
    const since30 = new Date(now.getTime() - 30 * 86_400_000);
    const out: Candidate[] = [];

    const [tenant, mrrAgg, vencido, ativosCustomers, cancel30, osAtrasadas, incidentes] =
      await Promise.all([
        this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { currency: true } }),
        this.prisma.contract.aggregate({
          where: { tenantId, deletedAt: null, status: 'ACTIVE' },
          _sum: { monthlyValue: true },
          _count: true,
        }),
        this.prisma.contractInvoice.aggregate({
          where: { tenantId, status: { in: ['OPEN', 'OVERDUE'] }, dueDate: { lt: now } },
          _sum: { amount: true },
        }),
        this.prisma.contract.count({ where: { tenantId, deletedAt: null, status: 'ACTIVE' } }),
        this.prisma.contract.count({ where: { tenantId, cancelledAt: { gte: since30 } } }),
        this.prisma.serviceOrder.count({
          where: {
            tenantId,
            deletedAt: null,
            status: { notIn: ['COMPLETED', 'CANCELLED'] },
            scheduledAt: { lt: now },
          },
        }),
        this.prisma.incident.findMany({
          where: {
            tenantId,
            status: 'OPEN',
            OR: [{ affectedCount: { gte: INCIDENT_AFETADOS } }, { severity: 'CRITICAL' }],
          },
          take: 10,
          select: { id: true, scopeLabel: true, severity: true, affectedCount: true, rootCause: true },
        }),
      ]);

    const cur = tenant?.currency ?? '';
    const mrr = n(mrrAgg._sum.monthlyValue);
    const venc = n(vencido._sum.amount);

    // Inadimplência vencida vs MRR
    if (mrr > 0) {
      const ratio = venc / mrr;
      if (ratio >= INAD_WARN) {
        out.push({
          kind: 'inadimplencia-alta',
          dedupeKey: `inadimplencia-alta:${ym()}`,
          severity: ratio >= INAD_CRIT ? 'CRITICAL' : 'WARNING',
          title: `Inadimplência vencida em ${(ratio * 100).toFixed(0)}% do MRR`,
          body: `Há ${venc} ${cur} vencidos em aberto (MRR ${mrr} ${cur}). Risco de caixa e de virar suspensão/churn — priorize cobrança/negociação.`,
        });
      }
    }

    // Churn 30d
    if (ativosCustomers > 0) {
      const churn = cancel30 / ativosCustomers;
      if (churn >= CHURN_WARN) {
        out.push({
          kind: 'churn-alto',
          dedupeKey: `churn-alto:${ym()}`,
          severity: churn >= CHURN_CRIT ? 'CRITICAL' : 'WARNING',
          title: `Churn de ${(churn * 100).toFixed(1)}% nos últimos 30 dias`,
          body: `${cancel30} cancelamentos sobre ${ativosCustomers} contratos ativos. Investigue motivos (preço, qualidade, concorrência).`,
        });
      }
    }

    // OS atrasadas
    if (osAtrasadas > OS_ATRASADAS_WARN) {
      out.push({
        kind: 'os-atrasadas',
        dedupeKey: `os-atrasadas:${ymd()}`,
        severity: 'WARNING',
        title: `${osAtrasadas} ordens de serviço atrasadas`,
        body: `OS abertas com data agendada já vencida. Reequilibre a agenda dos técnicos para não estourar SLA.`,
      });
    }

    // Incidentes grandes/críticos (um por incidente)
    for (const i of incidentes) {
      out.push({
        kind: 'incidente',
        dedupeKey: `incidente:${i.id}`,
        severity: i.severity === 'CRITICAL' ? 'CRITICAL' : 'WARNING',
        title: `Incidente de rede: ${i.scopeLabel} (${i.affectedCount} afetados)`,
        body: `Causa provável: ${i.rootCause}. ${i.affectedCount} clientes impactados — acompanhe a correção.`,
      });
    }

    return out;
  }
}
