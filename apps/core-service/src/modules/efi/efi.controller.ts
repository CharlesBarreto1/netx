import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import {
  GenerateEfiChargeRequestSchema,
  ListEfiChargesQuerySchema,
  UpsertEfiConfigRequestSchema,
  type AuthenticatedPrincipal,
  type GenerateEfiChargeRequest,
  type ListEfiChargesQuery,
  type UpsertEfiConfigRequest,
} from '@netx/shared';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { ZodBody } from '../../common/zod.pipe';
import { ZodQueryPipe } from '../crm/zod-query.pipe';

import { EfiAutogenService } from './efi-autogen.service';
import { EfiChargesService } from './efi-charges.service';
import { EfiConfigService } from './efi-config.service';

/**
 * EFI — configuração (admin) e cobranças (Pix/Bolix) sobre faturas.
 * Webhooks públicos ficam no EfiWebhookController (sem JWT).
 */
@ApiTags('efi')
@ApiBearerAuth()
@Controller('efi')
export class EfiController {
  constructor(
    private readonly config: EfiConfigService,
    private readonly charges: EfiChargesService,
    private readonly autogen: EfiAutogenService,
  ) {}

  // ── Config ─────────────────────────────────────────────────────────────────
  @Get('config')
  @RequirePermissions('efi.config.read')
  getConfig(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.config.get(user.tenantId);
  }

  @Put('config')
  @RequirePermissions('efi.config.write')
  upsertConfig(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodBody(UpsertEfiConfigRequestSchema) body: UpsertEfiConfigRequest,
  ) {
    return this.config.upsert(user.tenantId, user.sub, body);
  }

  @Post('config/register-webhook')
  @RequirePermissions('efi.config.write')
  registerWebhook(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.config.registerPixWebhook(user.tenantId, user.sub);
  }

  /** Roda a autogeração de cobranças sob demanda (admin/diagnóstico). */
  @Post('config/run-autogen')
  @RequirePermissions('efi.config.write')
  runAutogen() {
    return this.autogen.runOnce();
  }

  // ── Cobranças ────────────────────────────────────────────────────────────────
  @Get('charges')
  @RequirePermissions('efi.charges.read')
  list(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Query(new ZodQueryPipe(ListEfiChargesQuerySchema)) q: ListEfiChargesQuery,
  ) {
    return this.charges.list(user.tenantId, q);
  }

  /** Cobrança (mais recente/ativa) de uma fatura — pro Hub do Atendente. */
  @Get('invoices/:invoiceId/charge')
  @RequirePermissions('efi.charges.read')
  getForInvoice(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('invoiceId', new ParseUUIDPipe()) invoiceId: string,
  ) {
    return this.charges.getForInvoice(user.tenantId, invoiceId);
  }

  /** Emite (ou reaproveita) uma cobrança Pix/Bolix para a fatura. */
  @Post('invoices/:invoiceId/charge')
  @RequirePermissions('efi.charges.write')
  generate(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('invoiceId', new ParseUUIDPipe()) invoiceId: string,
    @ZodBody(GenerateEfiChargeRequestSchema) body: GenerateEfiChargeRequest,
  ) {
    return this.charges.createForInvoice(user.tenantId, user.sub, invoiceId, body);
  }
}
