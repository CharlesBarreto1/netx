/**
 * Métricas agregadas por domínio para o copiloto (read-only, tenant-scoped).
 * Uma função por domínio; a tool `metricas_dominio` despacha por nome. Mantém o
 * número de tools baixo (1 parametrizada) cobrindo largura de negócio.
 */
import type { PrismaService } from '../prisma/prisma.service';

export type MetricDomain =
  | 'ordens_servico'
  | 'estoque'
  | 'frota'
  | 'vendas'
  | 'caixa'
  | 'rh';

function n(v: unknown): number {
  if (v == null) return 0;
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function monthStart(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/** Converte groupBy [{status,_count}] em { STATUS: n }. */
function byStatus<T extends { _count: { _all: number } }>(
  rows: Array<T & { status: string }>,
): Record<string, number> {
  return Object.fromEntries(rows.map((r) => [r.status, r._count._all]));
}

export async function computeDomainMetrics(
  prisma: PrismaService,
  tenantId: string,
  dominio: MetricDomain,
): Promise<unknown> {
  const now = new Date();
  switch (dominio) {
    case 'ordens_servico': {
      const [porStatus, abertas, atrasadas] = await Promise.all([
        prisma.serviceOrder.groupBy({
          by: ['status'],
          where: { tenantId, deletedAt: null },
          _count: { _all: true },
        }),
        prisma.serviceOrder.count({
          where: { tenantId, deletedAt: null, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
        }),
        prisma.serviceOrder.count({
          where: {
            tenantId,
            deletedAt: null,
            status: { notIn: ['COMPLETED', 'CANCELLED'] },
            scheduledAt: { lt: now },
          },
        }),
      ]);
      return { por_status: byStatus(porStatus), abertas, atrasadas };
    }

    case 'estoque': {
      const [porTipo, ativos, serialPorStatus, locaisAtivos] = await Promise.all([
        prisma.product.groupBy({
          by: ['type'],
          where: { tenantId, deletedAt: null },
          _count: { _all: true },
        }),
        prisma.product.count({ where: { tenantId, deletedAt: null, isActive: true } }),
        prisma.serialItem.groupBy({ by: ['status'], where: { tenantId }, _count: { _all: true } }),
        prisma.stockLocation.count({ where: { tenantId, deletedAt: null, isActive: true } }),
      ]);
      return {
        produtos_ativos: ativos,
        produtos_por_tipo: Object.fromEntries(porTipo.map((r) => [r.type, r._count._all])),
        patrimonio_por_status: byStatus(serialPorStatus),
        locais_ativos: locaisAtivos,
      };
    }

    case 'frota': {
      const [porStatus, manutVencidas, despesaMes] = await Promise.all([
        prisma.vehicle.groupBy({
          by: ['status'],
          where: { tenantId, deletedAt: null },
          _count: { _all: true },
        }),
        prisma.maintenancePlan.count({
          where: { tenantId, deletedAt: null, active: true, nextDueDate: { lt: now } },
        }),
        prisma.fleetExpense.aggregate({
          where: { tenantId, deletedAt: null, occurredAt: { gte: monthStart() } },
          _sum: { amount: true },
        }),
      ]);
      return {
        veiculos_por_status: byStatus(porStatus),
        manutencoes_vencidas: manutVencidas,
        despesa_mes: n(despesaMes._sum.amount),
      };
    }

    case 'vendas': {
      const ms = monthStart();
      const [porStatus, ganhosMes, perdidosMes] = await Promise.all([
        prisma.deal.groupBy({
          by: ['status'],
          where: { tenantId, deletedAt: null },
          _count: { _all: true },
          _sum: { value: true },
        }),
        prisma.deal.aggregate({
          where: { tenantId, deletedAt: null, status: 'WON', closedAt: { gte: ms } },
          _sum: { value: true },
          _count: true,
        }),
        prisma.deal.aggregate({
          where: { tenantId, deletedAt: null, status: 'LOST', closedAt: { gte: ms } },
          _sum: { value: true },
          _count: true,
        }),
      ]);
      return {
        por_status: Object.fromEntries(
          porStatus.map((r) => [r.status, { qtd: r._count._all, valor: n(r._sum.value) }]),
        ),
        ganhos_mes: { qtd: ganhosMes._count, valor: n(ganhosMes._sum.value) },
        perdidos_mes: { qtd: perdidosMes._count, valor: n(perdidosMes._sum.value) },
      };
    }

    case 'caixa': {
      const ms = monthStart();
      const [aReceber, aPagar, aPagarVencido, entradas, saidas] = await Promise.all([
        prisma.oneTimeCharge.aggregate({
          where: { tenantId, deletedAt: null, status: 'OPEN' },
          _sum: { amount: true },
        }),
        prisma.supplierPayable.aggregate({ where: { tenantId, status: 'OPEN' }, _sum: { amount: true } }),
        prisma.supplierPayable.aggregate({
          where: { tenantId, status: 'OPEN', dueDate: { lt: now } },
          _sum: { amount: true },
        }),
        prisma.cashMovement.aggregate({
          where: { tenantId, type: 'INCOME', occurredAt: { gte: ms } },
          _sum: { amount: true },
        }),
        prisma.cashMovement.aggregate({
          where: { tenantId, type: 'OUTCOME', occurredAt: { gte: ms } },
          _sum: { amount: true },
        }),
      ]);
      return {
        cobrancas_avulsas_em_aberto: n(aReceber._sum.amount),
        contas_a_pagar_em_aberto: n(aPagar._sum.amount),
        contas_a_pagar_vencidas: n(aPagarVencido._sum.amount),
        entradas_mes: n(entradas._sum.amount),
        saidas_mes: n(saidas._sum.amount),
      };
    }

    case 'rh': {
      const [porStatus, ativos] = await Promise.all([
        prisma.employee.groupBy({
          by: ['status'],
          where: { tenantId, deletedAt: null },
          _count: { _all: true },
        }),
        prisma.employee.count({ where: { tenantId, deletedAt: null, status: 'ACTIVE' } }),
      ]);
      return { colaboradores_ativos: ativos, por_status: byStatus(porStatus) };
    }

    default:
      return { erro: `domínio desconhecido: ${String(dominio)}` };
  }
}
