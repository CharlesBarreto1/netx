import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { ZodSchema } from 'zod';

import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';
import {
  CreateHubUserSchema,
  CreateInstanceSchema,
  LicenseeDataSchema,
  MarkPaidSchema,
  SetStatusSchema,
  UpdateLicenseeSchema,
} from './admin.dto';

function parse<T>(schema: ZodSchema<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) {
    throw new BadRequestException(
      r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    );
  }
  return r.data;
}

/** Painel/admin do Hub — staff NetX. Protegido por login da equipe (Bearer JWT). */
@UseGuards(AdminGuard)
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Post('licensees')
  createLicensee(@Body() body: unknown) {
    return this.admin.createLicensee(parse(LicenseeDataSchema, body));
  }

  @Get('licensees')
  listLicensees() {
    return this.admin.listLicensees();
  }

  @Get('licensees/:id')
  getLicensee(@Param('id') id: string) {
    return this.admin.getLicensee(id);
  }

  @Post('licensees/:id')
  updateLicensee(@Param('id') id: string, @Body() body: unknown) {
    return this.admin.updateLicensee(id, parse(UpdateLicenseeSchema, body));
  }

  // Usuários da central do cliente
  @Post('hub-users')
  createHubUser(@Body() body: unknown) {
    return this.admin.createHubUser(parse(CreateHubUserSchema, body));
  }

  // Faturas
  @Get('invoices')
  listInvoices(@Query('licenseeId') licenseeId?: string) {
    return this.admin.listInvoices(licenseeId);
  }

  @Post('licensees/:id/generate-invoice')
  generateInvoice(@Param('id') id: string) {
    return this.admin.generateInvoiceNow(id);
  }

  @Post('invoices/:id/mark-paid')
  markPaid(@Param('id') id: string, @Body() body: unknown) {
    return this.admin.markInvoicePaid(id, parse(MarkPaidSchema, body));
  }

  @Post('instances')
  createInstance(@Body() body: unknown) {
    return this.admin.createInstance(parse(CreateInstanceSchema, body));
  }

  @Get('instances')
  listInstances() {
    return this.admin.listInstances();
  }

  @Post('instances/:id/status')
  setStatus(@Param('id') id: string, @Body() body: unknown) {
    return this.admin.setStatus(id, parse(SetStatusSchema, body));
  }

  @Post('instances/:id/rotate-key')
  rotateKey(@Param('id') id: string) {
    return this.admin.rotateKey(id);
  }
}
