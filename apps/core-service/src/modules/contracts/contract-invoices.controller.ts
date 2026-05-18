import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

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

// Schemas inline pra endpoints de ação rápida (discount/postpone). Quando
// virarem API documentada/pública, mover pra @netx/shared.
const ApplyDiscountRequestSchema = z.object({
  discountAmount: z.coerce.number().nonnegative().max(1_000_000_000),
  note: z.string().max(2000).optional(),
});
type ApplyDiscountRequest = z.infer<typeof ApplyDiscountRequestSchema>;

const PostponeInvoiceRequestSchema = z.object({
  // ISO 8601 date string ("2026-06-15" ou full datetime). Backend converte.
  newDueDate: z.string().min(8).max(40),
  note: z.string().max(2000).optional(),
});
type PostponeInvoiceRequest = z.infer<typeof PostponeInvoiceRequestSchema>;

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
    @ZodBody(ApplyDiscountRequestSchema) body: ApplyDiscountRequest,
  ) {
    return this.invoices.applyDiscount(
      user.tenantId,
      user.sub,
      id,
      body.discountAmount,
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
    @ZodBody(PostponeInvoiceRequestSchema) body: PostponeInvoiceRequest,
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
