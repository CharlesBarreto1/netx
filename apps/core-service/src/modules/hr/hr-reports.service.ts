import { Injectable } from '@nestjs/common';
import {
  type PayrollReportResponse,
  type PayrollReportRow,
} from '@netx/shared';

import { PrismaService } from '../prisma/prisma.service';

/**
 * Relatórios de RH. O de folha cruza colaboradores ATIVOS com o holerite da
 * competência: mostra pago, a pagar (líquido lançado − pago) e quem está sem
 * holerite (MISSING).
 */
@Injectable()
export class HrReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async payroll(
    tenantId: string,
    month?: string,
  ): Promise<PayrollReportResponse> {
    const ref = month ?? currentMonth();
    const referenceMonth = new Date(`${ref}-01T00:00:00.000Z`);

    const employees = await this.prisma.employee.findMany({
      where: { tenantId, deletedAt: null, status: { not: 'TERMINATED' } },
      select: { id: true, fullName: true, department: true },
      orderBy: { fullName: 'asc' },
    });

    const payslips = await this.prisma.payslip.findMany({
      where: { tenantId, deletedAt: null, referenceMonth },
      include: { payment: { select: { amount: true, paidAt: true } } },
    });
    const byEmployee = new Map(payslips.map((p) => [p.employeeId, p]));

    const rows: PayrollReportRow[] = employees.map((e) => {
      const p = byEmployee.get(e.id);
      if (!p) {
        return {
          employeeId: e.id,
          employeeName: e.fullName,
          department: e.department,
          payslipId: null,
          status: 'MISSING',
          netAmount: 0,
          paidAmount: 0,
          paidAt: null,
        };
      }
      return {
        employeeId: e.id,
        employeeName: e.fullName,
        department: e.department,
        payslipId: p.id,
        status: p.status,
        netAmount: Number(p.netAmount),
        paidAmount: p.payment ? Number(p.payment.amount) : 0,
        paidAt: p.payment?.paidAt ? p.payment.paidAt.toISOString() : null,
      };
    });

    const totalNet = rows.reduce((s, r) => s + r.netAmount, 0);
    const totalPaid = rows.reduce((s, r) => s + r.paidAmount, 0);

    return {
      month: ref,
      rows,
      totals: {
        employees: employees.length,
        totalNet: round2(totalNet),
        totalPaid: round2(totalPaid),
        totalPending: round2(totalNet - totalPaid),
      },
    };
  }
}

function currentMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
