/**
 * SifenController — endpoints REST do módulo SIFEN.
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 *   POST  /v1/sifen/documents              — emite documento manual
 *   GET   /v1/sifen/documents              — lista paginada com filtros
 *   GET   /v1/sifen/documents/:id          — detalhe + status
 *   GET   /v1/sifen/documents/:id/xml      — baixa XML assinado
 *   POST  /v1/sifen/documents/:id/cancel   — cancela DTE (janela 48h)
 */
import {
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import {
  CancelSifenDocumentRequestSchema,
  EmitSifenDocumentRequestSchema,
  ListSifenDocumentsQuerySchema,
  type AuthenticatedPrincipal,
  type CancelSifenDocumentRequest,
  type EmitSifenDocumentRequest,
  type ListSifenDocumentsQuery,
} from '@netx/shared';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { ZodBody } from '../../common/zod.pipe';
import { ZodQueryPipe } from '../crm/zod-query.pipe';
import { SifenService } from './sifen.service';

@ApiTags('sifen')
@ApiBearerAuth()
@Controller('sifen/documents')
export class SifenController {
  constructor(private readonly sifen: SifenService) {}

  @Post()
  @HttpCode(201)
  @RequirePermissions('sifen.emit')
  emit(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodBody(EmitSifenDocumentRequestSchema) body: EmitSifenDocumentRequest,
  ) {
    return this.sifen.emit(user.tenantId, user.sub, body);
  }

  @Get()
  @RequirePermissions('sifen.read')
  list(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Query(new ZodQueryPipe(ListSifenDocumentsQuerySchema))
    q: ListSifenDocumentsQuery,
  ) {
    return this.sifen.list(user.tenantId, q);
  }

  @Get(':id')
  @RequirePermissions('sifen.read')
  findOne(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.sifen.findById(user.tenantId, id);
  }

  /**
   * Download do XML assinado. Útil pra contador exportar pro sistema fiscal
   * ou guardar offline. Content-Disposition: attachment força o save dialog.
   */
  @Get(':id/xml')
  @Header('Content-Type', 'application/xml; charset=utf-8')
  @RequirePermissions('sifen.read')
  async downloadXml(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res({ passthrough: false }) res: Response,
  ) {
    const xml = await this.sifen.getSignedXml(user.tenantId, id);
    res.setHeader('Content-Disposition', `attachment; filename="dte-${id}.xml"`);
    res.send(xml);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermissions('sifen.cancel')
  cancel(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(CancelSifenDocumentRequestSchema) body: CancelSifenDocumentRequest,
  ) {
    return this.sifen.cancel(user.tenantId, user.sub, id, body);
  }
}
