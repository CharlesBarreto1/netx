import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import type {
  AgingReport,
  CashRegistersReport,
  CashRegistersReportQuery,
  ChurnReport,
  ChurnReportQuery,
  CustomersReport,
  CustomersReportQuery,
  FinanceReport,
  FinanceReportQuery,
  ForecastReport,
  ForecastReportQuery,
  MrrSeriesQuery,
  MrrSeriesReport,
} from '@netx/shared';

import { PrismaService } from '../prisma/prisma.service';

/**
 * Relatórios — read-only, agregam dados existentes.
 * Tudo escopado por tenant. Datas em strings YYYY-MM-DD são tratadas como
 * meio-dia local pra evitar shift de timezone.
 */
@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // CUSTOMERS
  // ---------------------------------------------------------------------------
  async customers(
    tenantId: string,
    q: CustomersReportQuery,
  ): Promise<CustomersReport> {
    const where: Prisma.CustomerWhereInput = { tenantId, deletedAt: null };

    const [total, individuals, companies, byStatusRaw, byCityRaw] =
      await Promise.all([
        this.prisma.customer.count({ where }),
        this.prisma.customer.count({ where: { ...where, type: 'INDIVIDUAL' } }),
        this.prisma.customer.count({ where: { ...where, type: 'COMPANY' } }),
        this.prisma.customer.groupBy({
          by: ['status'],
          where,
          _count: { _all: true },
        }),
        // Top 10 cidades — usa addresses primário.
        this.prisma.$queryRaw<{ city: string; count: bigint }[]>(Prisma.sql`
          SELECT a.city, COUNT(DISTINCT c.id)::bigint AS count
          FROM customers c
          JOIN customer_addresses a ON a.customer_id = c.id AND a.is_primary = true
          WHERE c.tenant_id = ${tenantId}::uuid AND c.deleted_at IS NULL
          GROUP BY a.city
          ORDER BY count DESC
          LIMIT 10
        `),
      ]);

    let newInPeriod: number | null = null;
    if (q.from || q.to) {
      newInPeriod = await this.prisma.customer.count({
        where: {
          ...where,
          createdAt: {
            ...(q.from ? { gte: new Date(`${q.from}T00:00:00`) } : {}),
            ...(q.to ? { lte: new Date(`${q.to}T23:59:59`) } : {}),
          },
        },
      });
    }

    return {
      totals: { total, individuals, companies },
      byStatus: byStatusRaw.map((r) => ({
        status: r.status,
        count: r._count._all,
      })),
      byCity: byCityRaw.map((r) => ({ city: r.city, count: Number(r.count) })),
      newInPeriod,
      range: { from: q.from ?? null, to: q.to ?? null },
    };
  }

  // ---------------------------------------------------------------------------
  // CASH REGISTERS — movimentos no período por caixa
  // ---------------------------------------------------------------------------
  async cashRegisters(
    tenantId: string,
    q: CashRegistersReportQuery,
  ): Promise<CashRegistersReport> {
    const fromDate = q.from ? new Date(`${q.from}T00:00:00`) : null;
    const toDate = q.to ? new Date(`${q.to}T23:59:59`) : null;

    const registers = await this.prisma.cashRegister.findMany({
      where: {
        tenantId,
        deletedAt: null,
        ...(q.cashRegisterId ? { id: q.cashRegisterId } : {}),
      },
      orderBy: { name: 'asc' },
    });

    const byRegister = await Promise.all(
      registers.map(async (cr) => {
        const where: Prisma.CashMovementWhereInput = {
          tenantId,
          cashRegisterId: cr.id,
          ...(fromDate || toDate
            ? {
                occurredAt: {
                  ...(fromDate ? { gte: fromDate } : {}),
                  ...(toDate ? { lte: toDate } : {}),
                },
              }
            : {}),
        };
        const grouped = await this.prisma.cashMovement.groupBy({
          by: ['type'],
          where,
          _sum: { amount: true },
        });
        const all = { income: 0, outcome: 0, transferIn: 0, transferOut: 0, adjustment: 0 };
        for (const g of grouped) {
          const v = Number(g._sum.amount ?? 0);
          if (g.type === 'INCOME') all.income = v;
          else if (g.type === 'OUTCOME') all.outcome = v;
          else if (g.type === 'TRANSFER_IN') all.transferIn = v;
          else if (g.type === 'TRANSFER_OUT') all.transferOut = v;
          else if (g.type === 'ADJUSTMENT') all.adjustment = v;
        }
        const netInPeriod =
          all.income + all.transferIn + all.adjustment - all.outcome - all.transferOut;

        // Saldo atual (sem filtrar período).
        const fullGrouped = await this.prisma.cashMovement.groupBy({
          by: ['type'],
          where: { tenantId, cashRegisterId: cr.id },
          _sum: { amount: true },
        });
        let totalAll = 0;
        for (const g of fullGrouped) {
          const v = Number(g._sum.amount ?? 0);
          if (['INCOME', 'TRANSFER_IN', 'ADJUSTMENT'].includes(g.type)) totalAll += v;
          else totalAll -= v;
        }

        return {
          id: cr.id,
          name: cr.name,
          currency: cr.currency,
          openingBalance: Number(cr.openingBalance),
          ...all,
          netInPeriod,
          currentBalance: Number(cr.openingBalance) + totalAll,
        };
      }),
    );

    const totalsAcrossRegisters = byRegister.reduce(
      (acc, r) => ({
        income: acc.income + r.income + r.transferIn,
        outcome: acc.outcome + r.outcome + r.transferOut,
        netInPeriod: acc.netInPeriod + r.netInPeriod,
      }),
      { income: 0, outcome: 0, netInPeriod: 0 },
    );

    return {
      range: { from: q.from ?? null, to: q.to ?? null },
      registers: byRegister,
      totalsAcrossRegisters,
    };
  }

  // ---------------------------------------------------------------------------
  // FINANCE — recebíveis (faturas + cobranças avulsas)
  // ---------------------------------------------------------------------------
  async finance(tenantId: string, q: FinanceReportQuery): Promise<FinanceReport> {
    const now = new Date();
    const fromDate = q.from ? new Date(`${q.from}T00:00:00`) : null;
    const toDate = q.to ? new Date(`${q.to}T23:59:59`) : null;

    // Em aberto — agora.
    const [openInvoices, openCharges] = await Promise.all([
      this.prisma.contractInvoice.aggregate({
        where: { tenantId, status: { in: ['OPEN', 'OVERDUE'] } },
        _count: { _all: true },
        _sum: { amount: true },
      }),
      this.prisma.oneTimeCharge.aggregate({
        where: { tenantId, status: 'OPEN', deletedAt: null },
        _count: { _all: true },
        _sum: { amount: true },
      }),
    ]);
    const open = {
      count: (openInvoices._count._all ?? 0) + (openCharges._count._all ?? 0),
      amount:
        Number(openInvoices._sum.amount ?? 0) + Number(openCharges._sum.amount ?? 0),
    };

    // Vencidos — agora.
    const [overdueInvoices, overdueCharges] = await Promise.all([
      this.prisma.contractInvoice.aggregate({
        where: {
          tenantId,
          status: { in: ['OPEN', 'OVERDUE'] },
          dueDate: { lt: now },
        },
        _count: { _all: true },
        _sum: { amount: true },
      }),
      this.prisma.oneTimeCharge.aggregate({
        where: {
          tenantId,
          status: 'OPEN',
          deletedAt: null,
          dueDate: { lt: now },
        },
        _count: { _all: true },
        _sum: { amount: true },
      }),
    ]);
    const overdue = {
      count:
        (overdueInvoices._count._all ?? 0) + (overdueCharges._count._all ?? 0),
      amount:
        Number(overdueInvoices._sum.amount ?? 0) +
        Number(overdueCharges._sum.amount ?? 0),
    };

    // Pagos no período.
    const dateRangeWhere = (field: 'paidAt') => ({
      ...(fromDate || toDate
        ? {
            [field]: {
              ...(fromDate ? { gte: fromDate } : {}),
              ...(toDate ? { lte: toDate } : {}),
            },
          }
        : {}),
    });

    const [paidInvoices, paidCharges] = await Promise.all([
      this.prisma.contractInvoice.aggregate({
        where: {
          tenantId,
          status: 'PAID',
          ...dateRangeWhere('paidAt'),
        },
        _count: { _all: true },
        _sum: { paidAmount: true },
      }),
      this.prisma.oneTimeCharge.aggregate({
        where: {
          tenantId,
          status: 'PAID',
          deletedAt: null,
          ...dateRangeWhere('paidAt'),
        },
        _count: { _all: true },
        _sum: { paidAmount: true },
      }),
    ]);
    const receivedInPeriod = {
      count: (paidInvoices._count._all ?? 0) + (paidCharges._count._all ?? 0),
      amount:
        Number(paidInvoices._sum.paidAmount ?? 0) +
        Number(paidCharges._sum.paidAmount ?? 0),
    };

    // Por método (no período).
    const [byMethodInvoices, byMethodCharges] = await Promise.all([
      this.prisma.contractInvoice.groupBy({
        by: ['paidVia'],
        where: { tenantId, status: 'PAID', ...dateRangeWhere('paidAt') },
        _count: { _all: true },
        _sum: { paidAmount: true },
      }),
      this.prisma.oneTimeCharge.groupBy({
        by: ['paidVia'],
        where: {
          tenantId,
          status: 'PAID',
          deletedAt: null,
          ...dateRangeWhere('paidAt'),
        },
        _count: { _all: true },
        _sum: { paidAmount: true },
      }),
    ]);
    const methodMap = new Map<string, { count: number; amount: number }>();
    for (const r of [...byMethodInvoices, ...byMethodCharges]) {
      const m = r.paidVia ?? 'UNSPECIFIED';
      const cur = methodMap.get(m) ?? { count: 0, amount: 0 };
      cur.count += r._count._all ?? 0;
      cur.amount += Number(r._sum.paidAmount ?? 0);
      methodMap.set(m, cur);
    }
    const byMethod = Array.from(methodMap.entries()).map(([method, v]) => ({
      method,
      ...v,
    }));

    // Por caixa (no período).
    const byCashRaw = await this.prisma.cashMovement.groupBy({
      by: ['cashRegisterId'],
      where: {
        tenantId,
        type: 'INCOME',
        ...(fromDate || toDate
          ? {
              occurredAt: {
                ...(fromDate ? { gte: fromDate } : {}),
                ...(toDate ? { lte: toDate } : {}),
              },
            }
          : {}),
      },
      _count: { _all: true },
      _sum: { amount: true },
    });
    const cashIds = byCashRaw.map((r) => r.cashRegisterId);
    const registers =
      cashIds.length > 0
        ? await this.prisma.cashRegister.findMany({
            where: { id: { in: cashIds } },
            select: { id: true, name: true },
          })
        : [];
    const nameById = new Map(registers.map((r) => [r.id, r.name]));
    const byCashRegister = byCashRaw.map((r) => ({
      cashRegisterId: r.cashRegisterId,
      cashRegisterName: nameById.get(r.cashRegisterId) ?? '—',
      count: r._count._all ?? 0,
      amount: Number(r._sum.amount ?? 0),
    }));

    return {
      range: { from: q.from ?? null, to: q.to ?? null },
      open,
      overdue,
      receivedInPeriod,
      byMethod,
      byCashRegister,
    };
  }

  // ---------------------------------------------------------------------------
  // FORECAST — projeção mensal baseada em contratos ACTIVE
  // ---------------------------------------------------------------------------
  async forecast(
    tenantId: string,
    q: ForecastReportQuery,
  ): Promise<ForecastReport> {
    const months = q.months ?? 6;

    const contracts = await this.prisma.contract.findMany({
      where: { tenantId, status: 'ACTIVE', deletedAt: null },
      select: { id: true, monthlyValue: true },
    });

    const monthlyBaseline = contracts.reduce(
      (s, c) => s + Number(c.monthlyValue),
      0,
    );

    // Para cada mês à frente, assume que TODOS os contratos atuais continuam
    // ativos (modelo simples — sem churn). Numa próxima iteração: usar churn
    // histórico pra ajustar.
    const now = new Date();
    const byMonth: ForecastReport['byMonth'] = [];
    for (let i = 0; i < months; i++) {
      const target = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const yearMonth = `${target.getFullYear()}-${String(
        target.getMonth() + 1,
      ).padStart(2, '0')}`;
      byMonth.push({
        yearMonth,
        activeContracts: contracts.length,
        expectedRevenue: monthlyBaseline,
      });
    }

    return {
      months,
      monthlyBaseline,
      byMonth,
      totalForecast: monthlyBaseline * months,
      generatedAt: new Date().toISOString(),
    };
  }

  // ---------------------------------------------------------------------------
  // AGING — inadimplência por faixa de atraso (snapshot, vencidos AGORA)
  // ---------------------------------------------------------------------------
  async aging(tenantId: string): Promise<AgingReport> {
    // due_date é @db.Date → (CURRENT_DATE - due_date) dá dias inteiros.
    // status é enum no PG: castamos pra text pra comparar com literais.
    const rows = await this.prisma.$queryRaw<
      { bucket: string; count: bigint; amount: number }[]
    >(Prisma.sql`
      SELECT
        CASE
          WHEN (CURRENT_DATE - due_date) <= 15 THEN '1-15'
          WHEN (CURRENT_DATE - due_date) <= 30 THEN '16-30'
          WHEN (CURRENT_DATE - due_date) <= 60 THEN '31-60'
          ELSE '60+'
        END AS bucket,
        COUNT(*)::bigint AS count,
        COALESCE(SUM(amount), 0) AS amount
      FROM contract_invoices
      WHERE tenant_id = ${tenantId}::uuid
        AND status::text IN ('OPEN', 'OVERDUE')
        AND due_date < CURRENT_DATE
      GROUP BY bucket
    `);

    const byBucket = new Map(
      rows.map((r) => [r.bucket, { count: Number(r.count), amount: Number(r.amount) }]),
    );
    const buckets = [
      { label: '1–15d', key: '1-15' },
      { label: '16–30d', key: '16-30' },
      { label: '31–60d', key: '31-60' },
      { label: '+60d', key: '60+' },
    ].map(({ label, key }) => ({
      label,
      count: byBucket.get(key)?.count ?? 0,
      amount: byBucket.get(key)?.amount ?? 0,
    }));

    return {
      totalCount: buckets.reduce((s, b) => s + b.count, 0),
      totalAmount: buckets.reduce((s, b) => s + b.amount, 0),
      buckets,
    };
  }

  // ---------------------------------------------------------------------------
  // MRR SERIES — soma das mensalidades dos contratos ativos em cada mês
  // ---------------------------------------------------------------------------
  // Modelo simples: usa monthlyValue ATUAL de cada contrato (não temos histórico
  // de valor por mês). "Ativo no mês X" = começou (activatedAt ?? createdAt) até
  // o fim do mês e não foi cancelado antes do início do mês.
  async mrrSeries(
    tenantId: string,
    q: MrrSeriesQuery,
  ): Promise<MrrSeriesReport> {
    const months = q.months ?? 12;
    const contracts = await this.prisma.contract.findMany({
      where: { tenantId, deletedAt: null },
      select: {
        monthlyValue: true,
        activatedAt: true,
        createdAt: true,
        cancelledAt: true,
      },
    });

    const now = new Date();
    const byMonth: MrrSeriesReport['byMonth'] = [];
    for (let i = months - 1; i >= 0; i--) {
      const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthEnd = new Date(
        now.getFullYear(),
        now.getMonth() - i + 1,
        0,
        23,
        59,
        59,
      );
      let mrr = 0;
      let active = 0;
      for (const c of contracts) {
        const start = c.activatedAt ?? c.createdAt;
        if (start > monthEnd) continue; // ainda não tinha começado
        if (c.cancelledAt && c.cancelledAt < monthStart) continue; // já cancelado
        active += 1;
        mrr += Number(c.monthlyValue);
      }
      byMonth.push({
        yearMonth: `${monthStart.getFullYear()}-${String(
          monthStart.getMonth() + 1,
        ).padStart(2, '0')}`,
        activeContracts: active,
        mrr,
      });
    }

    return {
      months,
      current: byMonth.length > 0 ? byMonth[byMonth.length - 1].mrr : 0,
      byMonth,
    };
  }

  // ---------------------------------------------------------------------------
  // CHURN — cancelamentos no mês / base ativa no início do mês
  // ---------------------------------------------------------------------------
  async churn(tenantId: string, q: ChurnReportQuery): Promise<ChurnReport> {
    const months = q.months ?? 12;
    const contracts = await this.prisma.contract.findMany({
      where: { tenantId, deletedAt: null },
      select: { activatedAt: true, createdAt: true, cancelledAt: true },
    });

    const now = new Date();
    const byMonth: ChurnReport['byMonth'] = [];
    for (let i = months - 1; i >= 0; i--) {
      const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthEnd = new Date(
        now.getFullYear(),
        now.getMonth() - i + 1,
        0,
        23,
        59,
        59,
      );
      let activeStart = 0;
      let cancelled = 0;
      for (const c of contracts) {
        const start = c.activatedAt ?? c.createdAt;
        // Base ativa no INÍCIO do mês: começou antes do mês e não cancelado antes dele.
        if (start < monthStart && (!c.cancelledAt || c.cancelledAt >= monthStart)) {
          activeStart += 1;
        }
        // Cancelados DENTRO do mês.
        if (c.cancelledAt && c.cancelledAt >= monthStart && c.cancelledAt <= monthEnd) {
          cancelled += 1;
        }
      }
      const churnPct =
        activeStart > 0 ? Math.round((cancelled / activeStart) * 1000) / 10 : 0;
      byMonth.push({
        yearMonth: `${monthStart.getFullYear()}-${String(
          monthStart.getMonth() + 1,
        ).padStart(2, '0')}`,
        activeStart,
        cancelled,
        churnPct,
      });
    }

    const avgChurnPct =
      byMonth.length > 0
        ? Math.round(
            (byMonth.reduce((s, m) => s + m.churnPct, 0) / byMonth.length) * 10,
          ) / 10
        : 0;

    return { months, avgChurnPct, byMonth };
  }
}
