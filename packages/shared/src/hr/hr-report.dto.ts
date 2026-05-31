import { z } from 'zod';

/** Relatórios de RH: folha paga/a pagar por competência + resumo de ponto. */

export const PayrollReportQuerySchema = z.object({
  /** Mês YYYY-MM. Default = mês corrente no backend. */
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
});
export type PayrollReportQuery = z.infer<typeof PayrollReportQuerySchema>;

export interface PayrollReportRow {
  employeeId: string;
  employeeName: string;
  department: string | null;
  payslipId: string | null;
  status: 'DRAFT' | 'APPROVED' | 'PAID' | 'CANCELLED' | 'MISSING';
  netAmount: number;
  paidAmount: number;
  paidAt: string | null;
}

export interface PayrollReportResponse {
  month: string; // YYYY-MM
  rows: PayrollReportRow[];
  totals: {
    employees: number;
    totalNet: number;   // soma dos líquidos lançados
    totalPaid: number;  // soma do que já foi pago
    totalPending: number; // totalNet - totalPaid (a pagar)
  };
}

export const TimesheetReportQuerySchema = z.object({
  employeeId: z.string().uuid().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type TimesheetReportQuery = z.infer<typeof TimesheetReportQuerySchema>;
