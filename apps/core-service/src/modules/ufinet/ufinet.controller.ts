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
import { BadRequestException, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  ListUfinetServicesQuerySchema,
  RetryUfinetServiceRequestSchema,
  type AuthenticatedPrincipal,
  type ListUfinetServicesQuery,
  type RetryUfinetServiceRequest,
} from '@netx/shared';

const OntActionSchema = z.object({
  action: z.enum(['REFRESH_ONT', 'RESET_ONT', 'STATUS_ONT']),
});
type OntActionRequest = z.infer<typeof OntActionSchema>;

const AdoptSchema = z.object({
  contractId: z.string().uuid(),
  oltId: z.string().uuid(),
});
type AdoptRequest = z.infer<typeof AdoptSchema>;

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

  /**
   * Saúde da integração Ufinet (circuit breaker). `degraded=true` = Ufinet
   * indisponível e o poller em modo sonda; as O.S retomam sozinhas ao voltar.
   */
  @Get('health')
  @RequirePermissions('ufinet.orders.read')
  health() {
    return this.orders.healthSnapshot();
  }

  @Get('contract/:contractId')
  @RequirePermissions('ufinet.orders.read')
  byContract(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('contractId', new ParseUUIDPipe()) contractId: string,
  ) {
    return this.orders.findByContractForApi(user.tenantId, contractId);
  }

  /** Trace completo de requests/responses NetX↔Ufinet — evidência pra chamados. */
  @Get(':id/trace')
  @RequirePermissions('ufinet.orders.read')
  trace(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.orders.getTrace(user.tenantId, id);
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

  /**
   * ADOÇÃO — vincula um serviço JÁ ativo na Ufinet (cadastrado manualmente lá)
   * a um contrato do NetX. Consulta o inventário pelo externalId (Contract.code)
   * e cria o UfinetService em ACTIVE, sem refazer a alta.
   */
  @Post('adopt')
  @RequirePermissions('ufinet.orders.retry')
  adopt(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodBody(AdoptSchema) body: AdoptRequest,
  ) {
    return this.orders.adoptExisting({
      tenantId: user.tenantId,
      contractId: body.contractId,
      oltId: body.oltId,
      actorUserId: user.sub,
    });
  }

  /**
   * Ações de manutenção/diagnóstico na ONT (REFRESH/RESET/STATUS_ONT).
   * ASSÍNCRONO: dispara o comando e devolve o orderId — a cadeia
   * orquestrador→NCS→OLT→ONT é lenta e estouraria o timeout do gateway.
   * O resultado é consultado em GET .../ont-action/:orderId.
   */
  @Post('contract/:contractId/ont-action')
  @RequirePermissions('ufinet.orders.retry')
  ontAction(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('contractId', new ParseUUIDPipe()) contractId: string,
    @ZodBody(OntActionSchema) body: OntActionRequest,
  ) {
    return this.orders.dispatchOntAction(user.tenantId, contractId, body.action, user.sub);
  }

  /** Consulta o resultado de uma ação de ONT já disparada (front faz poll). */
  @Get('contract/:contractId/ont-action/:orderId')
  @RequirePermissions('ufinet.orders.retry')
  ontActionResult(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('contractId', new ParseUUIDPipe()) contractId: string,
    @Param('orderId') orderId: string,
  ) {
    if (!/^\d+$/.test(orderId)) throw new BadRequestException('orderId inválido');
    return this.orders.pollOntAction(user.tenantId, contractId, orderId);
  }
}
