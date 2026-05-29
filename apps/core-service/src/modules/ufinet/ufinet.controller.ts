/**
 * /v1/ufinet/services — leitura do estado dos serviços Ufinet + retry.
 *
 * As MUTAÇÕES (alta/confirmar/baja/suspender) NÃO são expostas aqui — elas
 * acontecem como efeito do ciclo de vida do contrato (create/install/suspend/
 * cancel). Este controller é read-only + retry de FAILED (Hub do Atendente).
 *
 * Permissions:
 *   ufinet.orders.read   — listar / ver status
 *   ufinet.orders.retry  — reprocessar um serviço FAILED
 */
import { Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  ListUfinetServicesQuerySchema,
  RetryUfinetServiceRequestSchema,
  type AuthenticatedPrincipal,
  type ListUfinetServicesQuery,
  type RetryUfinetServiceRequest,
} from '@netx/shared';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { ZodBody, ZodValidationPipe } from '../../common/zod.pipe';

import { UfinetOrdersService } from './ufinet-orders.service';

@ApiTags('ufinet')
@ApiBearerAuth()
@Controller('ufinet/services')
export class UfinetController {
  constructor(private readonly orders: UfinetOrdersService) {}

  @Get()
  @RequirePermissions('ufinet.orders.read')
  list(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Query(new ZodValidationPipe(ListUfinetServicesQuerySchema)) q: ListUfinetServicesQuery,
  ) {
    return this.orders.list(user.tenantId, q);
  }

  @Get('contract/:contractId')
  @RequirePermissions('ufinet.orders.read')
  byContract(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('contractId', new ParseUUIDPipe()) contractId: string,
  ) {
    return this.orders.findByContractForApi(user.tenantId, contractId);
  }

  @Post(':id/retry')
  @RequirePermissions('ufinet.orders.retry')
  retry(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(RetryUfinetServiceRequestSchema) body: RetryUfinetServiceRequest,
  ) {
    return this.orders.retry(user.tenantId, id, body);
  }
}
