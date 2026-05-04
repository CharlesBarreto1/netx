import { api } from './api';

// =============================================================================
// TYPES (espelho do shared)
// =============================================================================
export interface CustomersReport {
  totals: { total: number; individuals: number; companies: number };
  byStatus: Array<{ status: string; count: number }>;
  byCity: Array<{ city: string; count: number }>;
  newInPeriod: number | null;
  range: { from: string | null; to: string | null };
}

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
    currentBalance: number;
  }>;
  totalsAcrossRegisters: { income: number; outcome: number; netInPeriod: number };
}

export interface FinanceReport {
  range: { from: string | null; to: string | null };
  open: { count: number; amount: number };
  overdue: { count: number; amount: number };
  receivedInPeriod: { count: number; amount: number };
  byMethod: Array<{ method: string; count: number; amount: number }>;
  byCashRegister: Array<{
    cashRegisterId: string;
    cashRegisterName: string;
    count: number;
    amount: number;
  }>;
}

export interface ForecastReport {
  months: number;
  monthlyBaseline: number;
  byMonth: Array<{
    yearMonth: string;
    activeContracts: number;
    expectedRevenue: number;
  }>;
  totalForecast: number;
  generatedAt: string;
}

// =============================================================================
// API
// =============================================================================
function qs(params: Record<string, unknown>): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') usp.set(k, String(v));
  }
  const s = usp.toString();
  return s ? `?${s}` : '';
}

export const reportsApi = {
  customersPath: (params: { from?: string; to?: string } = {}) =>
    `/v1/reports/customers${qs(params)}`,
  cashRegistersPath: (params: { from?: string; to?: string; cashRegisterId?: string } = {}) =>
    `/v1/reports/cash-registers${qs(params)}`,
  financePath: (params: { from?: string; to?: string } = {}) =>
    `/v1/reports/finance${qs(params)}`,
  forecastPath: (params: { months?: number } = {}) =>
    `/v1/reports/forecast${qs(params)}`,
  customers(p?: { from?: string; to?: string }) {
    return api.get<CustomersReport>(this.customersPath(p));
  },
  cashRegisters(p?: { from?: string; to?: string; cashRegisterId?: string }) {
    return api.get<CashRegistersReport>(this.cashRegistersPath(p));
  },
  finance(p?: { from?: string; to?: string }) {
    return api.get<FinanceReport>(this.financePath(p));
  },
  forecast(p?: { months?: number }) {
    return api.get<ForecastReport>(this.forecastPath(p));
  },
};
