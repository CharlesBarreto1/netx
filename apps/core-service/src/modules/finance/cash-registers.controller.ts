import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import {
  AddCashRegisterMemberRequestSchema,
  CashMovementAttachmentPresignRequestSchema,
  CreateCashRegisterRequestSchema,
  CreateMovementRequestSchema,
  CreateTransferRequestSchema,
  ListCashRegistersQuerySchema,
  ListMovementsQuerySchema,
  UpdateCashRegisterRequestSchema,
  type AddCashRegisterMemberRequest,
  type AuthenticatedPrincipal,
  type CashMovementAttachmentPresignRequest,
  type CreateCashRegisterRequest,
  type CreateMovementRequest,
  type CreateTransferRequest,
  type ListCashRegistersQuery,
  type ListMovementsQuery,
  type UpdateCashRegisterRequest,
} from '@netx/shared';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { ZodBody } from '../../common/zod.pipe';
import { ZodQueryPipe } from '../crm/zod-query.pipe';
import { CashMovementsService } from './cash-movements.service';
import { CashRegistersService } from './cash-registers.service';

@ApiTags('finance')
@ApiBearerAuth()
@Controller('cash-registers')
export class CashRegistersController {
  constructor(
    private readonly registers: CashRegistersService,
    private readonly movements: CashMovementsService,
  ) {}

  @Get()
  @RequirePermissions('finance.charges.read') // mínimo pra ver lista; admins têm sempre
  list(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Query(new ZodQueryPipe(ListCashRegistersQuerySchema)) q: ListCashRegistersQuery,
  ) {
    const isManager = user.permissions.includes('cash_registers.manage');
    return this.registers.list(user.tenantId, user.sub, isManager, q);
  }

  @Get(':id')
  @RequirePermissions('finance.charges.read')
  findOne(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const isManager = user.permissions.includes('cash_registers.manage');
    return this.registers.findById(user.tenantId, user.sub, isManager, id);
  }

  @Post()
  @RequirePermissions('cash_registers.manage')
  create(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodBody(CreateCashRegisterRequestSchema) body: CreateCashRegisterRequest,
  ) {
    return this.registers.create(user.tenantId, user.sub, body);
  }

  @Patch(':id')
  @RequirePermissions('cash_registers.manage')
  update(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(UpdateCashRegisterRequestSchema) body: UpdateCashRegisterRequest,
  ) {
    return this.registers.update(user.tenantId, user.sub, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('cash_registers.manage')
  async remove(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.registers.deactivate(user.tenantId, user.sub, id);
  }

  @Post(':id/members')
  @RequirePermissions('cash_registers.manage')
  addMember(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(AddCashRegisterMemberRequestSchema) body: AddCashRegisterMemberRequest,
  ) {
    return this.registers.addMember(user.tenantId, user.sub, id, body);
  }

  @Delete(':id/members/:userId')
  @HttpCode(204)
  @RequirePermissions('cash_registers.manage')
  async removeMember(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('userId', new ParseUUIDPipe()) userId: string,
  ): Promise<void> {
    await this.registers.removeMember(user.tenantId, user.sub, id, userId);
  }

  // ---------------------------------------------------------------------------
  // MOVEMENTS / BALANCE / TRANSFER
  // ---------------------------------------------------------------------------
  @Get(':id/balance')
  @RequirePermissions('finance.charges.read')
  balance(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const isManager = user.permissions.includes('cash_registers.manage');
    return this.movements.balance(user.tenantId, user.sub, isManager, id);
  }

  @Get(':id/movements')
  @RequirePermissions('finance.charges.read')
  listMovements(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query(new ZodQueryPipe(ListMovementsQuerySchema)) q: ListMovementsQuery,
  ) {
    const isManager = user.permissions.includes('cash_registers.manage');
    return this.movements.list(user.tenantId, user.sub, isManager, id, q);
  }

  /** Sangria / ajuste / entrada manual. Exige operador no caixa. */
  @Post(':id/movements')
  @RequirePermissions('finance.charges.write')
  createMovement(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(CreateMovementRequestSchema) body: CreateMovementRequest,
  ) {
    const isManager = user.permissions.includes('cash_registers.manage');
    return this.movements.createManual(
      user.tenantId,
      user.sub,
      isManager,
      id,
      body,
    );
  }

  /**
   * Pede URL presigned pra subir a NF/recibo de uma sangria ANTES de lançar.
   * O client sobe direto no MinIO e manda a storageKey no createMovement.
   */
  @Post(':id/movements/attachment-presign')
  @RequirePermissions('finance.charges.write')
  presignMovementAttachment(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(CashMovementAttachmentPresignRequestSchema)
    body: CashMovementAttachmentPresignRequest,
  ) {
    const isManager = user.permissions.includes('cash_registers.manage');
    return this.movements.presignAttachment(
      user.tenantId,
      user.sub,
      isManager,
      id,
      body,
    );
  }

  /**
   * Reverte um lançamento manual (sangria/ajuste/entrada) ou uma transferência
   * lançada errada. Movimentos de fatura/cobrança/folha são bloqueados aqui —
   * estorne pela origem. Exige gerente de caixa.
   */
  @Delete(':id/movements/:movementId')
  @HttpCode(204)
  @RequirePermissions('cash_registers.manage')
  async reverseMovement(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('movementId', new ParseUUIDPipe()) movementId: string,
  ): Promise<void> {
    await this.movements.reverseManual(user.tenantId, user.sub, movementId);
  }

  /** Transferência entre 2 caixas (atomic). Operador em ambos os caixas. */
  @Post(':id/transfer')
  @RequirePermissions('finance.charges.write')
  transfer(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(CreateTransferRequestSchema) body: CreateTransferRequest,
  ) {
    const isManager = user.permissions.includes('cash_registers.manage');
    return this.movements.transfer(
      user.tenantId,
      user.sub,
      isManager,
      id,
      body,
    );
  }
}
