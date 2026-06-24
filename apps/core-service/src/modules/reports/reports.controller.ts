import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import {
  CashRegistersReportQuerySchema,
  ChurnReportQuerySchema,
  CustomersReportQuerySchema,
  FinanceReportQuerySchema,
  ForecastReportQuerySchema,
  MrrSeriesQuerySchema,
  type AuthenticatedPrincipal,
  type CashRegistersReportQuery,
  type ChurnReportQuery,
  type CustomersReportQuery,
  type FinanceReportQuery,
  type ForecastReportQuery,
  type MrrSeriesQuery,
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

  @Get('aging')
  @RequirePermissions('reports.read')
  aging(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.reports.aging(user.tenantId);
  }

  @Get('mrr-series')
  @RequirePermissions('reports.read')
  mrrSeries(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Query(new ZodQueryPipe(MrrSeriesQuerySchema)) q: MrrSeriesQuery,
  ) {
    return this.reports.mrrSeries(user.tenantId, q);
  }

  @Get('churn')
  @RequirePermissions('reports.read')
  churn(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Query(new ZodQueryPipe(ChurnReportQuerySchema)) q: ChurnReportQuery,
  ) {
    return this.reports.churn(user.tenantId, q);
  }
}
