import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import {
  CashRegistersReportQuerySchema,
  CustomersReportQuerySchema,
  FinanceReportQuerySchema,
  ForecastReportQuerySchema,
  type AuthenticatedPrincipal,
  type CashRegistersReportQuery,
  type CustomersReportQuery,
  type FinanceReportQuery,
  type ForecastReportQuery,
} from '@netx/shared';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { ZodQueryPipe } from '../crm/zod-query.pipe';
import { ReportsService } from './reports.service';

@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('customers')
  @RequirePermissions('reports.read')
  customers(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Query(new ZodQueryPipe(CustomersReportQuerySchema)) q: CustomersReportQuery,
  ) {
    return this.reports.customers(user.tenantId, q);
  }

  @Get('cash-registers')
  @RequirePermissions('reports.read')
  cashRegisters(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Query(new ZodQueryPipe(CashRegistersReportQuerySchema))
    q: CashRegistersReportQuery,
  ) {
    return this.reports.cashRegisters(user.tenantId, q);
  }

  @Get('finance')
  @RequirePermissions('reports.read')
  finance(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Query(new ZodQueryPipe(FinanceReportQuerySchema)) q: FinanceReportQuery,
  ) {
    return this.reports.finance(user.tenantId, q);
  }

  @Get('forecast')
  @RequirePermissions('reports.read')
  forecast(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Query(new ZodQueryPipe(ForecastReportQuerySchema)) q: ForecastReportQuery,
  ) {
    return this.reports.forecast(user.tenantId, q);
  }
}
