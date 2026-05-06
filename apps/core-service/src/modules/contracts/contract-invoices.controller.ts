import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import {
  CancelContractInvoiceRequestSchema,
  CreateContractInvoiceRequestSchema,
  ListContractInvoicesQuerySchema,
  PayContractInvoiceRequestSchema,
  type AuthenticatedPrincipal,
  type CancelContractInvoiceRequest,
  type CreateContractInvoiceRequest,
  type ListContractInvoicesQuery,
  type PayContractInvoiceRequest,
} from '@netx/shared';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { ZodBody } from '../../common/zod.pipe';
import { ZodQueryPipe } from '../crm/zod-query.pipe';
import { ContractInvoicesService } from './contract-invoices.service';

@ApiTags('contracts/invoices')
@ApiBearerAuth()
@Controller()
export class ContractInvoicesController {
  constructor(private readonly invoices: ContractInvoicesService) {}

  // Listagem global (com filtros por contrato/cliente)
  @Get('contract-invoices')
  @RequirePermissions('contracts.read')
  list(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Query(new ZodQueryPipe(ListContractInvoicesQuerySchema)) q: ListContractInvoicesQuery,
  ) {
    return this.invoices.list(user.tenantId, q);
  }

  @Get('contract-invoices/:id')
  @RequirePermissions('contracts.read')
  getOne(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.invoices.findById(user.tenantId, id);
  }

  // Listagem aninhada: faturas de um contrato
  @Get('contracts/:contractId/invoices')
  @RequirePermissions('contracts.read')
  listByContract(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('contractId', new ParseUUIDPipe()) contractId: string,
    @Query(new ZodQueryPipe(ListContractInvoicesQuerySchema)) q: ListContractInvoicesQuery,
  ) {
    return this.invoices.list(user.tenantId, { ...q, contractId });
  }

  @Post('contracts/:contractId/invoices')
  @RequirePermissions('contracts.write')
  create(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('contractId', new ParseUUIDPipe()) contractId: string,
    @ZodBody(CreateContractInvoiceRequestSchema) body: CreateContractInvoiceRequest,
  ) {
    return this.invoices.create(user.tenantId, user.sub, contractId, body);
  }

  @Post('contract-invoices/:id/pay')
  @RequirePermissions('contracts.write')
  pay(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(PayContractInvoiceRequestSchema) body: PayContractInvoiceRequest,
  ) {
    const isManager = user.permissions.includes('cash_registers.manage');
    const canDiscount = user.permissions.includes('finance.discount.apply');
    return this.invoices.pay(
      user.tenantId,
      user.sub,
      isManager,
      canDiscount,
      id,
      body,
    );
  }

  @Post('contract-invoices/:id/cancel')
  @RequirePermissions('contracts.write')
  cancel(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(CancelContractInvoiceRequestSchema) body: CancelContractInvoiceRequest,
  ) {
    return this.invoices.cancel(user.tenantId, user.sub, id, body);
  }

  /**
   * Aplicar/atualizar desconto ANTES do pagamento. Persiste em
   * `discountAmount` mas NÃO marca como paga.
   */
  @Post('contract-invoices/:id/discount')
  @RequirePermissions('finance.discount.apply')
  applyDiscount(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: { discountAmount: number; note?: string },
  ) {
    return this.invoices.applyDiscount(
      user.tenantId,
      user.sub,
      id,
      Number(body.discountAmount) || 0,
      body.note,
    );
  }

  /**
   * Prorrogar fatura — altera vencimento sem dar baixa. Útil quando
   * cliente pede prazo extra. Reativa contrato suspenso por overdue se
   * a fatura prorrogada era a "última inadimplência".
   */
  @Post('contract-invoices/:id/postpone')
  @RequirePermissions('contracts.write')
  postpone(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: { newDueDate: string; note?: string },
  ) {
    return this.invoices.postpone(
      user.tenantId,
      user.sub,
      id,
      body.newDueDate,
      body.note,
    );
  }
}
