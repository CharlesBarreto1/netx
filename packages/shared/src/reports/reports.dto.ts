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
