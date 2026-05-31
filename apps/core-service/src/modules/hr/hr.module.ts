import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { FinanceModule } from '../finance/finance.module';

import { CompanyPostsService } from './company-posts.service';
import { EmployeeDocumentsService } from './employee-documents.service';
import { EmployeesService } from './employees.service';
import { HrReportsService } from './hr-reports.service';
import { HrSelfService } from './hr-self.service';
import { PayrollService } from './payroll.service';
import { TimeclockService } from './timeclock.service';
import {
  CompanyPostsController,
  EmployeeDocumentsController,
  EmployeesController,
  HrReportsController,
  HrSelfController,
  PayrollController,
  TimeclockController,
} from './hr.controller';

/**
 * Módulo de RH — colaboradores, documentos (anexos via StorageModule global),
 * ponto, folha (integra no caixa via FinanceModule), blog e o self-service do
 * portal do colaborador (/hr/me). StorageService vem do StorageModule @Global.
 */
@Module({
  imports: [AuditModule, FinanceModule],
  controllers: [
    EmployeesController,
    EmployeeDocumentsController,
    TimeclockController,
    PayrollController,
    CompanyPostsController,
    HrReportsController,
    HrSelfController,
  ],
  providers: [
    EmployeesService,
    EmployeeDocumentsService,
    TimeclockService,
    PayrollService,
    CompanyPostsService,
    HrReportsService,
    HrSelfService,
  ],
})
export class HrModule {}
