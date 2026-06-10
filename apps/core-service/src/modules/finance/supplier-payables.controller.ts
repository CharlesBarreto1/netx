import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import {
  ListPayablesQuerySchema,
  PaySupplierPayableRequestSchema,
  type AuthenticatedPrincipal,
  type ListPayablesQuery,
  type PaySupplierPayableRequest,
} from '@netx/shared';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { ZodBody } from '../../common/zod.pipe';

import { SupplierPayablesService } from './supplier-payables.service';

/**
 * Contas a pagar — /v1/finance/payables
 *
 * Parcelas nascem do lançamento de compra de estoque (à vista/a prazo);
 * aqui é consulta + baixa (pay) + estorno (unpay).
 */
@ApiTags('finance')
@ApiBearerAuth()
@Controller('finance/payables')
export class SupplierPayablesController {
  constructor(private readonly payables: SupplierPayablesService) {}

  @Get()
  @RequirePermissions('finance.payables.read')
  list(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Query() query: Record<string, string>,
  ) {
    const parsed = ListPayablesQuerySchema.parse(query) as ListPayablesQuery;
    return this.payables.list(u.tenantId, parsed);
  }

  /** Totais pro cabeçalho da tela (em aberto, vencido, pago no mês). */
  @Get('summary')
  @RequirePermissions('finance.payables.read')
  summary(@CurrentUser() u: AuthenticatedPrincipal) {
    return this.payables.summary(u.tenantId);
  }

  @Get(':id')
  @RequirePermissions('finance.payables.read')
  findById(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.payables.findById(u.tenantId, id);
  }

  /** Dá baixa numa parcela (opcionalmente lançando a saída num caixa). */
  @Post(':id/pay')
  @RequirePermissions('finance.payables.write')
  pay(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(PaySupplierPayableRequestSchema) body: PaySupplierPayableRequest,
  ) {
    const isManager = u.permissions.includes('cash_registers.manage');
    return this.payables.pay(u.tenantId, u.sub, isManager, id, body);
  }

  /** Estorna a baixa de uma parcela paga errada (desfaz o caixa). */
  @Post(':id/unpay')
  @RequirePermissions('cash_registers.manage')
  unpay(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.payables.unpay(u.tenantId, u.sub, id);
  }
}
