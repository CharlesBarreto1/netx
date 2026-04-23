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
    return this.invoices.pay(user.tenantId, user.sub, id, body);
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
}
