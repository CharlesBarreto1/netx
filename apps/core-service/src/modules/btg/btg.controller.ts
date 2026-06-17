import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import {
  CreateBtgRecurrenceRequestSchema,
  GenerateBtgChargeRequestSchema,
  ListBtgChargesQuerySchema,
  ListBtgRecurrencesQuerySchema,
  SetBrGatewayRequestSchema,
  UpsertBtgConfigRequestSchema,
  type AuthenticatedPrincipal,
  type CreateBtgRecurrenceRequest,
  type GenerateBtgChargeRequest,
  type ListBtgChargesQuery,
  type ListBtgRecurrencesQuery,
  type SetBrGatewayRequest,
  type UpsertBtgConfigRequest,
} from '@netx/shared';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { ZodBody } from '../../common/zod.pipe';
import { ZodQueryPipe } from '../crm/zod-query.pipe';

import { BtgChargesService } from './btg-charges.service';
import { BtgConfigService } from './btg-config.service';
import { BtgRecurrenceService } from './btg-recurrence.service';

/**
 * BTG — config (admin), consentimento OAuth, cobranças (boleto/Pix) e
 * recorrências (Pix Automático). Webhooks ficam no BtgWebhookController.
 */
@ApiTags('btg')
@ApiBearerAuth()
@Controller('btg')
export class BtgController {
  constructor(
    private readonly config: BtgConfigService,
    private readonly charges: BtgChargesService,
    private readonly recurrence: BtgRecurrenceService,
  ) {}

  // ── Config ─────────────────────────────────────────────────────────────────
  @Get('config')
  @RequirePermissions('btg.config.read')
  getConfig(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.config.get(user.tenantId);
  }

  @Put('config')
  @RequirePermissions('btg.config.write')
  upsertConfig(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodBody(UpsertBtgConfigRequestSchema) body: UpsertBtgConfigRequest,
  ) {
    return this.config.upsert(user.tenantId, user.sub, body);
  }

  /** Início do consentimento: devolve a URL do BTG Id p/ autorizar a conta PJ. */
  @Post('config/authorize')
  @RequirePermissions('btg.config.write')
  authorize(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.config.startAuthorization(user.tenantId);
  }

  /**
   * Diagnóstico: mostra a authorizeUrl exata + probes client_credentials nos
   * dois hosts BTG Id (descobre em qual ambiente o client_id está registrado).
   */
  @Get('config/diagnostics')
  @RequirePermissions('btg.config.write')
  diagnostics(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.config.diagnose(user.tenantId);
  }

  /** Registra (ou re-registra) o webhook no BTG. */
  @Post('config/register-webhook')
  @RequirePermissions('btg.config.write')
  registerWebhook(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.config.registerWebhook(user.tenantId, user.sub);
  }

  /** Gateway BR ativo do tenant (EFI ou BTG) — usado pela autogeração. */
  @Get('gateway')
  @RequirePermissions('btg.config.read')
  async getGateway(@CurrentUser() user: AuthenticatedPrincipal) {
    return { gateway: await this.config.getBrGateway(user.tenantId) };
  }

  @Put('gateway')
  @RequirePermissions('btg.config.write')
  setGateway(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodBody(SetBrGatewayRequestSchema) body: SetBrGatewayRequest,
  ) {
    return this.config.setBrGateway(user.tenantId, user.sub, body.gateway);
  }

  // ── Cobranças (boleto/Pix) ───────────────────────────────────────────────────
  @Get('charges')
  @RequirePermissions('btg.charges.read')
  listCharges(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Query(new ZodQueryPipe(ListBtgChargesQuerySchema)) q: ListBtgChargesQuery,
  ) {
    return this.charges.list(user.tenantId, q);
  }

  @Get('invoices/:invoiceId/charge')
  @RequirePermissions('btg.charges.read')
  getForInvoice(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('invoiceId', new ParseUUIDPipe()) invoiceId: string,
  ) {
    return this.charges.getForInvoice(user.tenantId, invoiceId);
  }

  @Post('invoices/:invoiceId/charge')
  @RequirePermissions('btg.charges.write')
  generate(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('invoiceId', new ParseUUIDPipe()) invoiceId: string,
    @ZodBody(GenerateBtgChargeRequestSchema) body: GenerateBtgChargeRequest,
  ) {
    return this.charges.createForInvoice(user.tenantId, user.sub, invoiceId, body);
  }

  /** PDF do boleto (proxy autenticado). */
  @Get('charges/:chargeId/pdf')
  @RequirePermissions('btg.charges.read')
  async pdf(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('chargeId', new ParseUUIDPipe()) chargeId: string,
    @Res() res: Response,
  ) {
    const pdf = await this.charges.getPdf(user.tenantId, chargeId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="boleto-${chargeId}.pdf"`);
    res.send(pdf);
  }

  // ── Pix Automático (recorrências) ────────────────────────────────────────────
  @Get('recurrences')
  @RequirePermissions('btg.charges.read')
  listRecurrences(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Query(new ZodQueryPipe(ListBtgRecurrencesQuerySchema)) q: ListBtgRecurrencesQuery,
  ) {
    return this.recurrence.list(user.tenantId, q);
  }

  @Get('contracts/:contractId/recurrence')
  @RequirePermissions('btg.charges.read')
  getRecurrenceForContract(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('contractId', new ParseUUIDPipe()) contractId: string,
  ) {
    return this.recurrence.getForContract(user.tenantId, contractId);
  }

  @Post('contracts/:contractId/recurrence')
  @RequirePermissions('btg.charges.write')
  createRecurrence(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('contractId', new ParseUUIDPipe()) contractId: string,
    @ZodBody(CreateBtgRecurrenceRequestSchema) body: CreateBtgRecurrenceRequest,
  ) {
    return this.recurrence.createForContract(user.tenantId, user.sub, contractId, body);
  }

  @Post('recurrences/:id/cancel')
  @RequirePermissions('btg.charges.write')
  cancelRecurrence(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.recurrence.cancel(user.tenantId, user.sub, id);
  }
}
