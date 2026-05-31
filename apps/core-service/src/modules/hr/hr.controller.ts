import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import {
  ClockInOutSchema,
  CreateCompanyPostRequestSchema,
  CreateEmployeeDocumentSchema,
  CreateEmployeeRequestSchema,
  CreatePayslipRequestSchema,
  CreateTimeCorrectionSchema,
  CreateTimeEntrySchema,
  ListCompanyPostsQuerySchema,
  ListEmployeeDocumentsQuerySchema,
  ListEmployeesQuerySchema,
  ListPayslipsQuerySchema,
  ListTimeCorrectionsQuerySchema,
  ListTimeEntriesQuerySchema,
  PaySalaryRequestSchema,
  RequestUploadUrlSchema,
  ReviewTimeCorrectionSchema,
  SignDocumentSchema,
  UpdateCompanyPostRequestSchema,
  UpdateEmployeeDocumentSchema,
  UpdateEmployeeRequestSchema,
  UpdatePayslipRequestSchema,
  type AuthenticatedPrincipal,
  type ClockInOut,
  type CreateCompanyPostRequest,
  type CreateEmployeeDocument,
  type CreateEmployeeRequest,
  type CreatePayslipRequest,
  type CreateTimeCorrection,
  type CreateTimeEntry,
  type PaySalaryRequest,
  type RequestUploadUrl,
  type ReviewTimeCorrection,
  type UpdateCompanyPostRequest,
  type UpdateEmployeeDocument,
  type UpdateEmployeeRequest,
  type UpdatePayslipRequest,
} from '@netx/shared';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { ZodBody } from '../../common/zod.pipe';

import { CompanyPostsService } from './company-posts.service';
import { EmployeeDocumentsService } from './employee-documents.service';
import { EmployeesService } from './employees.service';
import { HrReportsService } from './hr-reports.service';
import { HrSelfService } from './hr-self.service';
import { PayrollService } from './payroll.service';
import { TimeclockService } from './timeclock.service';

function clientIp(req: Request): string | null {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return req.ip ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// COLABORADORES — /v1/hr/employees
// ─────────────────────────────────────────────────────────────────────────────
@ApiTags('hr')
@ApiBearerAuth()
@Controller('hr/employees')
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  @Get()
  @RequirePermissions('hr.read')
  list(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Query() query: Record<string, string>,
  ) {
    return this.employees.list(u.tenantId, ListEmployeesQuerySchema.parse(query));
  }

  @Get(':id')
  @RequirePermissions('hr.read')
  findById(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.employees.findById(u.tenantId, id);
  }

  @Post()
  @RequirePermissions('hr.write')
  create(
    @CurrentUser() u: AuthenticatedPrincipal,
    @ZodBody(CreateEmployeeRequestSchema) body: CreateEmployeeRequest,
  ) {
    return this.employees.create(u.tenantId, u.sub, body);
  }

  @Patch(':id')
  @RequirePermissions('hr.write')
  update(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(UpdateEmployeeRequestSchema) body: UpdateEmployeeRequest,
  ) {
    return this.employees.update(u.tenantId, u.sub, id, body);
  }

  @Delete(':id')
  @RequirePermissions('hr.delete')
  @HttpCode(204)
  async remove(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.employees.remove(u.tenantId, u.sub, id);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DOCUMENTOS — /v1/hr/employees/:employeeId/documents
// ─────────────────────────────────────────────────────────────────────────────
@ApiTags('hr')
@ApiBearerAuth()
@Controller('hr/employees/:employeeId/documents')
export class EmployeeDocumentsController {
  constructor(private readonly documents: EmployeeDocumentsService) {}

  @Get()
  @RequirePermissions('hr.read')
  list(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('employeeId', new ParseUUIDPipe()) employeeId: string,
    @Query() query: Record<string, string>,
  ) {
    return this.documents.list(
      u.tenantId,
      employeeId,
      ListEmployeeDocumentsQuerySchema.parse(query),
    );
  }

  @Post('upload-url')
  @RequirePermissions('hr.documents.manage')
  uploadUrl(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('employeeId', new ParseUUIDPipe()) employeeId: string,
    @ZodBody(RequestUploadUrlSchema) body: RequestUploadUrl,
  ) {
    return this.documents.requestUploadUrl(u.tenantId, employeeId, body);
  }

  @Post()
  @RequirePermissions('hr.documents.manage')
  create(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('employeeId', new ParseUUIDPipe()) employeeId: string,
    @ZodBody(CreateEmployeeDocumentSchema) body: CreateEmployeeDocument,
  ) {
    return this.documents.create(u.tenantId, u.sub, employeeId, body);
  }

  @Get(':docId/download')
  @RequirePermissions('hr.read')
  download(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('employeeId', new ParseUUIDPipe()) employeeId: string,
    @Param('docId', new ParseUUIDPipe()) docId: string,
  ) {
    return this.documents.getDownloadUrl(u.tenantId, employeeId, docId);
  }

  @Patch(':docId')
  @RequirePermissions('hr.documents.manage')
  update(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('employeeId', new ParseUUIDPipe()) employeeId: string,
    @Param('docId', new ParseUUIDPipe()) docId: string,
    @ZodBody(UpdateEmployeeDocumentSchema) body: UpdateEmployeeDocument,
  ) {
    return this.documents.update(u.tenantId, u.sub, employeeId, docId, body);
  }

  @Post(':docId/sign')
  @RequirePermissions('hr.documents.manage')
  sign(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('employeeId', new ParseUUIDPipe()) employeeId: string,
    @Param('docId', new ParseUUIDPipe()) docId: string,
    @Req() req: Request,
  ) {
    return this.documents.sign(u.tenantId, employeeId, docId, {
      ipAddress: clientIp(req),
      userAgent: req.headers['user-agent'] ?? null,
      actorUserId: u.sub,
    });
  }

  @Delete(':docId')
  @RequirePermissions('hr.documents.manage')
  @HttpCode(204)
  async remove(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('employeeId', new ParseUUIDPipe()) employeeId: string,
    @Param('docId', new ParseUUIDPipe()) docId: string,
  ) {
    await this.documents.remove(u.tenantId, u.sub, employeeId, docId);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PONTO — /v1/hr/timeclock
// ─────────────────────────────────────────────────────────────────────────────
@ApiTags('hr')
@ApiBearerAuth()
@Controller('hr/timeclock')
export class TimeclockController {
  constructor(private readonly timeclock: TimeclockService) {}

  @Get('entries')
  @RequirePermissions('hr.read')
  listEntries(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Query() query: Record<string, string>,
  ) {
    return this.timeclock.listEntries(
      u.tenantId,
      ListTimeEntriesQuerySchema.parse(query),
    );
  }

  @Post('entries')
  @RequirePermissions('hr.timeclock.manage')
  createEntry(
    @CurrentUser() u: AuthenticatedPrincipal,
    @ZodBody(CreateTimeEntrySchema) body: CreateTimeEntry,
  ) {
    return this.timeclock.createManualEntry(u.tenantId, u.sub, body);
  }

  @Get('timesheet/:employeeId')
  @RequirePermissions('hr.read')
  timesheet(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('employeeId', new ParseUUIDPipe()) employeeId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.timeclock.timesheet(u.tenantId, employeeId, from, to);
  }

  @Get('corrections')
  @RequirePermissions('hr.read')
  listCorrections(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Query() query: Record<string, string>,
  ) {
    return this.timeclock.listCorrections(
      u.tenantId,
      ListTimeCorrectionsQuerySchema.parse(query),
    );
  }

  @Post('corrections/:id/review')
  @RequirePermissions('hr.timeclock.manage')
  review(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(ReviewTimeCorrectionSchema) body: ReviewTimeCorrection,
  ) {
    return this.timeclock.reviewCorrection(u.tenantId, u.sub, id, body);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FOLHA — /v1/hr/payroll
// ─────────────────────────────────────────────────────────────────────────────
@ApiTags('hr')
@ApiBearerAuth()
@Controller('hr/payroll')
export class PayrollController {
  constructor(private readonly payroll: PayrollService) {}

  @Get('payslips')
  @RequirePermissions('hr.payroll.manage')
  list(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Query() query: Record<string, string>,
  ) {
    return this.payroll.list(u.tenantId, ListPayslipsQuerySchema.parse(query));
  }

  @Get('payslips/:id')
  @RequirePermissions('hr.payroll.manage')
  findById(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.payroll.findById(u.tenantId, id);
  }

  @Post('payslips')
  @RequirePermissions('hr.payroll.manage')
  create(
    @CurrentUser() u: AuthenticatedPrincipal,
    @ZodBody(CreatePayslipRequestSchema) body: CreatePayslipRequest,
  ) {
    return this.payroll.create(u.tenantId, u.sub, body);
  }

  @Patch('payslips/:id')
  @RequirePermissions('hr.payroll.manage')
  update(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(UpdatePayslipRequestSchema) body: UpdatePayslipRequest,
  ) {
    return this.payroll.update(u.tenantId, u.sub, id, body);
  }

  @Post('payslips/:id/approve')
  @RequirePermissions('hr.payroll.manage')
  approve(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.payroll.approve(u.tenantId, u.sub, id);
  }

  @Post('payslips/:id/pay')
  @RequirePermissions('hr.payroll.manage')
  pay(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(PaySalaryRequestSchema) body: PaySalaryRequest,
  ) {
    return this.payroll.pay(u.tenantId, u.sub, id, body);
  }

  @Get('payslips/:id/receipt')
  @RequirePermissions('hr.payroll.manage')
  receipt(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.payroll.receiptUrl(u.tenantId, id);
  }

  @Post('payslips/:id/reverse')
  @RequirePermissions('hr.payroll.manage')
  @HttpCode(204)
  async reverse(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.payroll.reversePayment(u.tenantId, u.sub, id);
  }

  @Delete('payslips/:id')
  @RequirePermissions('hr.payroll.manage')
  @HttpCode(204)
  async remove(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.payroll.remove(u.tenantId, u.sub, id);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BLOG / NOTÍCIAS — /v1/hr/posts
// ─────────────────────────────────────────────────────────────────────────────
@ApiTags('hr')
@ApiBearerAuth()
@Controller('hr/posts')
export class CompanyPostsController {
  constructor(private readonly posts: CompanyPostsService) {}

  @Get()
  @RequirePermissions('hr.blog.manage')
  list(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Query() query: Record<string, string>,
  ) {
    return this.posts.list(u.tenantId, ListCompanyPostsQuerySchema.parse(query));
  }

  @Get(':id')
  @RequirePermissions('hr.blog.manage')
  findById(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.posts.findById(u.tenantId, id);
  }

  @Post()
  @RequirePermissions('hr.blog.manage')
  create(
    @CurrentUser() u: AuthenticatedPrincipal,
    @ZodBody(CreateCompanyPostRequestSchema) body: CreateCompanyPostRequest,
  ) {
    return this.posts.create(u.tenantId, u.sub, body);
  }

  @Patch(':id')
  @RequirePermissions('hr.blog.manage')
  update(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(UpdateCompanyPostRequestSchema) body: UpdateCompanyPostRequest,
  ) {
    return this.posts.update(u.tenantId, u.sub, id, body);
  }

  @Delete(':id')
  @RequirePermissions('hr.blog.manage')
  @HttpCode(204)
  async remove(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.posts.remove(u.tenantId, u.sub, id);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// RELATÓRIOS — /v1/hr/reports
// ─────────────────────────────────────────────────────────────────────────────
@ApiTags('hr')
@ApiBearerAuth()
@Controller('hr/reports')
export class HrReportsController {
  constructor(private readonly reports: HrReportsService) {}

  @Get('payroll')
  @RequirePermissions('hr.payroll.manage')
  payroll(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Query('month') month?: string,
  ) {
    return this.reports.payroll(u.tenantId, month);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SELF-SERVICE (PORTAL) — /v1/hr/me  (só exige login + Employee vinculado)
// ─────────────────────────────────────────────────────────────────────────────
@ApiTags('hr')
@ApiBearerAuth()
@Controller('hr/me')
export class HrSelfController {
  constructor(private readonly self: HrSelfService) {}

  @Get('dashboard')
  dashboard(@CurrentUser() u: AuthenticatedPrincipal) {
    return this.self.dashboard(u.tenantId, u.sub);
  }

  @Get('profile')
  profile(@CurrentUser() u: AuthenticatedPrincipal) {
    return this.self.profile(u.tenantId, u.sub);
  }

  @Get('clock-status')
  clockStatus(@CurrentUser() u: AuthenticatedPrincipal) {
    return this.self.clockStatus(u.tenantId, u.sub);
  }

  @Post('clock')
  clock(
    @CurrentUser() u: AuthenticatedPrincipal,
    @ZodBody(ClockInOutSchema) body: ClockInOut,
    @Req() req: Request,
  ) {
    return this.self.clock(u.tenantId, u.sub, body, clientIp(req));
  }

  @Get('timesheet')
  timesheet(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.self.timesheet(u.tenantId, u.sub, from, to);
  }

  @Post('corrections')
  createCorrection(
    @CurrentUser() u: AuthenticatedPrincipal,
    @ZodBody(CreateTimeCorrectionSchema) body: CreateTimeCorrection,
  ) {
    return this.self.createCorrection(u.tenantId, u.sub, body);
  }

  @Get('earnings')
  earnings(@CurrentUser() u: AuthenticatedPrincipal) {
    return this.self.earnings(u.tenantId, u.sub);
  }

  @Get('documents')
  documents(@CurrentUser() u: AuthenticatedPrincipal) {
    return this.self.documents(u.tenantId, u.sub);
  }

  @Get('documents/:docId/download')
  documentDownload(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('docId', new ParseUUIDPipe()) docId: string,
  ) {
    return this.self.documentDownloadUrl(u.tenantId, u.sub, docId);
  }

  @Post('documents/:docId/sign')
  signDocument(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('docId', new ParseUUIDPipe()) docId: string,
    @Body() _body: unknown,
    @Req() req: Request,
  ) {
    SignDocumentSchema.parse(_body ?? { accepted: true });
    return this.self.signDocument(u.tenantId, u.sub, docId, {
      ip: clientIp(req),
      userAgent: req.headers['user-agent'] ?? null,
    });
  }

  @Get('feed')
  feed(@CurrentUser() u: AuthenticatedPrincipal) {
    return this.self.feed(u.tenantId);
  }
}
