/**
 * FieldController — rotas Field-específicas (BFF read-only + cobertura + ações
 * privilegiadas de campo). Field é CONSUMIDOR: o que escreve de verdade (O.S,
 * provisionamento, venda) vai pela API do módulo dono. Aqui vivem só o agregado
 * Assinante 360 (leitura), a consulta de cobertura e o desbloqueio com step-up.
 */
import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import {
  CoverageCheckQuerySchema,
  FieldUnblockRequestSchema,
  type AuthenticatedPrincipal,
  type CoverageCheckQuery,
  type FieldUnblockRequest,
} from '@netx/shared';

import { CurrentUser, RequirePermissions, RequireStepUp } from '../../common/decorators';
import { ZodBody } from '../../common/zod.pipe';
import { ZodQueryPipe } from '../crm/zod-query.pipe';

import { CoverageService } from './coverage.service';
import { FieldActionsService } from './field-actions.service';
import { Subscriber360Service } from './subscriber360.service';

@ApiTags('field')
@ApiBearerAuth()
@Controller('field')
export class FieldController {
  constructor(
    private readonly subscriber360: Subscriber360Service,
    private readonly coverage: CoverageService,
    private readonly actions: FieldActionsService,
  ) {}

  /** Assinante 360 — agregado read-only (ERP + CPE + rede óptica + RADIUS). */
  @Get('subscriber360/:customerId')
  @RequirePermissions('field.subscriber360.read')
  getSubscriber360(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
  ) {
    return this.subscriber360.getByCustomer(user.tenantId, customerId);
  }

  /** Cobertura: CTOs/NAPs com porta livre perto de um ponto (nova venda). */
  @Get('coverage')
  @RequirePermissions('field.coverage.read')
  checkCoverage(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Query(new ZodQueryPipe(CoverageCheckQuerySchema)) q: CoverageCheckQuery,
  ) {
    return this.coverage.check(user.tenantId, q);
  }

  /**
   * Desbloqueio de cliente (reativa contrato) — AÇÃO PRIVILEGIADA. Online-
   * obrigatório, exige `field.unblock` + sessão elevada (step-up) e é auditado.
   */
  @Post('unblock/:contractId')
  @HttpCode(200)
  @RequirePermissions('field.unblock')
  @RequireStepUp()
  unblock(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('contractId', new ParseUUIDPipe()) contractId: string,
    @ZodBody(FieldUnblockRequestSchema) body: FieldUnblockRequest,
    @Req() req: Request,
  ) {
    return this.actions.unblock(user.tenantId, user.sub, contractId, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      note: body.note,
    });
  }
}
