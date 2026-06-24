import { z } from 'zod';

// =============================================================================
// QUERIES
// =============================================================================
const dateRangeShape = {
  from: z.string().date().optional(),
  to: z.string().date().optional(),
};

export const CustomersReportQuerySchema = z.object({ ...dateRangeShape });
export type CustomersReportQuery = z.infer<typeof CustomersReportQuerySchema>;

export const CashRegistersReportQuerySchema = z.object({
  ...dateRangeShape,
  cashRegisterId: z.string().uuid().optional(),
});
export type CashRegistersReportQuery = z.infer<
  typeof CashRegistersReportQuerySchema
>;

export const FinanceReportQuerySchema = z.object({ ...dateRangeShape });
export type FinanceReportQuery = z.infer<typeof FinanceReportQuerySchema>;

export const ForecastReportQuerySchema = z.object({
  /** Quantos meses à frente projetar (1..24). Default 6. */
  months: z.coerce.number().int().min(1).max(24).default(6),
});
export type ForecastReportQuery = z.infer<typeof ForecastReportQuerySchema>;

export const MrrSeriesQuerySchema = z.object({
  /** Quantos meses de histórico (1..24). Default 12. */
  months: z.coerce.number().int().min(1).max(24).default(12),
});
export type MrrSeriesQuery = z.infer<typeof MrrSeriesQuerySchema>;

export const ChurnReportQuerySchema = z.object({
  /** Quantos meses de histórico (1..24). Default 12. */
  months: z.coerce.number().int().min(1).max(24).default(12),
});
export type ChurnReportQuery = z.infer<typeof ChurnReportQuerySchema>;

// =============================================================================
// RESPONSES
// =============================================================================

/** Relatório de clientes — composição da base. */
export interface CustomersReport {
  totals: { total: number; individuals: number; companies: number };
  byStatus: Array<{ status: string; count: number }>;
  byCity: Array<{ city: string; count: number }>;
  /** Quando from/to informados, conta os criados no período. */
  newInPeriod: number | null;
  range: { from: string | null; to: string | null };
}

/** Relatório por caixa (movimentos no período). */
export interface CashRegistersReport {
  range: { from: string | null; to: string | null };
  registers: Array<{
    id: string;
    name: string;
    currency: string;
    openingBalance: number;
    income: number;
    outcome: number;
    transferIn: number;
    transferOut: number;
    adjustment: number;
    netInPeriod: number;
    /** Saldo total acumulado (não respeita o range — sempre full history). */
    currentBalance: number;
  }>;
  totalsAcrossRegisters: {
    income: number;
    outcome: number;
    netInPeriod: number;
  };
}

/** Relatório financeiro — recebíveis (faturas + cobranças avulsas). */
export interface FinanceReport {
  range: { from: string | null; to: string | null };
  /** Em aberto AGORA (não filtra por range — é foto do estado atual). */
  open: { count: number; amount: number };
  /** Vencidos AGORA (não pagos com dueDate < now). */
  overdue: { count: number; amount: number };
  /** Pagos no período (filtra paidAt entre from..to). */
  receivedInPeriod: { count: number; amount: number };
  /** Recebido por método (no período). */
  byMethod: Array<{ method: string; count: number; amount: number }>;
  /** Recebido por caixa (no período). */
  byCashRegister: Array<{
    cashRegisterId: string;
    cashRegisterName: string;
    count: number;
    amount: number;
  }>;
}

/** Inadimplência por faixa de atraso (snapshot — vencidos AGORA). */
export interface AgingReport {
  /** Total de faturas vencidas (todas as faixas). */
  totalCount: number;
  /** Soma vencida (todas as faixas). */
  totalAmount: number;
  /** Faixas fixas: 1–15, 16–30, 31–60, +60 dias. */
  buckets: Array<{ label: string; count: number; amount: number }>;
}

/** Série histórica de MRR (soma das mensalidades dos contratos ativos no mês). */
export interface MrrSeriesReport {
  months: number;
  /** MRR do mês corrente (= ForecastReport.monthlyBaseline). */
  current: number;
  byMonth: Array<{
    /** YYYY-MM */
    yearMonth: string;
    activeContracts: number;
    mrr: number;
  }>;
}

/** Churn mensal — cancelamentos no mês / base ativa no início do mês. */
export interface ChurnReport {
  months: number;
  /** Média simples do churn% nos meses retornados. */
  avgChurnPct: number;
  byMonth: Array<{
    /** YYYY-MM */
    yearMonth: string;
    activeStart: number;
    cancelled: number;
    churnPct: number;
  }>;
}

/** Previsão de faturamento dos próximos N meses. */
export interface ForecastReport {
  months: number;
  /** Soma das mensalidades dos contratos ativos. */
  monthlyBaseline: number;
  /** Por mês: estimativa do que entra (mensal × contratos ACTIVE no mês X). */
  byMonth: Array<{
    /** YYYY-MM */
    yearMonth: string;
    activeContracts: number;
    expectedRevenue: number;
  }>;
  /** Soma de tudo. */
  totalForecast: number;
  generatedAt: string;
}
