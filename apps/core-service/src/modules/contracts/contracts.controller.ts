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
import { z } from 'zod';

// Schema inline pra /:id/trust-extend — fica perto do uso porque é pequeno
// e específico desse controller. Quando virar API pública/documentada, mover
// pra @netx/shared.
const TrustExtendRequestSchema = z.object({
  days: z.number().int().min(1).max(60).optional(),
  note: z.string().max(2000).optional(),
});
type TrustExtendRequest = z.infer<typeof TrustExtendRequestSchema>;

import {
  CancelContractRequestSchema,
  CreateContractRequestSchema,
  ListContractsQuerySchema,
  ReactivateContractRequestSchema,
  SuspendContractRequestSchema,
  UpdateContractRequestSchema,
  type AuthenticatedPrincipal,
  type CancelContractRequest,
  type CreateContractRequest,
  type ListContractsQuery,
  type ReactivateContractRequest,
  type SuspendContractRequest,
  type UpdateContractRequest,
} from '@netx/shared';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { ZodBody } from '../../common/zod.pipe';
import { ZodQueryPipe } from '../crm/zod-query.pipe';
import { ContractsService } from './contracts.service';
import { OverdueScanService } from './overdue-scan.service';

@ApiTags('contracts')
@ApiBearerAuth()
@Controller('contracts')
export class ContractsController {
  constructor(
    private readonly contracts: ContractsService,
    private readonly overdueScan: OverdueScanService,
  ) {}

  @Get()
  @RequirePermissions('contracts.read')
  list(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Query(new ZodQueryPipe(ListContractsQuerySchema)) q: ListContractsQuery,
  ) {
    return this.contracts.list(user.tenantId, q);
  }

  @Get(':id')
  @RequirePermissions('contracts.read')
  getOne(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.contracts.findById(user.tenantId, id);
  }

  @Post()
  @RequirePermissions('contracts.write')
  create(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodBody(CreateContractRequestSchema) body: CreateContractRequest,
  ) {
    return this.contracts.create(user.tenantId, user.sub, body);
  }

  @Patch(':id')
  @RequirePermissions('contracts.write')
  update(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(UpdateContractRequestSchema) body: UpdateContractRequest,
  ) {
    return this.contracts.update(user.tenantId, user.sub, id, body);
  }

  @Post(':id/suspend')
  @RequirePermissions('contracts.write')
  suspend(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(SuspendContractRequestSchema) body: SuspendContractRequest,
  ) {
    return this.contracts.suspend(user.tenantId, user.sub, id, body);
  }

  @Post(':id/reactivate')
  @RequirePermissions('contracts.write')
  reactivate(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(ReactivateContractRequestSchema) body: ReactivateContractRequest,
  ) {
    return this.contracts.reactivate(user.tenantId, user.sub, id, body);
  }

  /**
   * Religue de confiança — reativa um contrato suspenso por overdue
   * concedendo um prazo (default 5 dias). Cron de overdue verifica e
   * re-suspende ao expirar.
   */
  @Post(':id/trust-extend')
  @RequirePermissions('contracts.write')
  trustExtend(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(TrustExtendRequestSchema) body: TrustExtendRequest,
  ) {
    return this.contracts.trustExtend(user.tenantId, user.sub, id, {
      days: body.days ?? 5,
      note: body.note,
    });
  }

  @Post(':id/cancel')
  @RequirePermissions('contracts.write')
  cancel(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(CancelContractRequestSchema) body: CancelContractRequest,
  ) {
    return this.contracts.cancel(user.tenantId, user.sub, id, body);
  }

  /**
   * Desconecta forçadamente o cliente do NAS (CoA Disconnect-Request) sem
   * mudar estado do contrato. Útil pra forçar nova autenticação após troca
   * de plano, debug, ou liberar IP travado.
   */
  @Post(':id/kick')
  @HttpCode(200)
  @RequirePermissions('contracts.write')
  kick(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.contracts.kick(user.tenantId, user.sub, id);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('contracts.delete')
  async remove(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.contracts.remove(user.tenantId, user.sub, id);
  }

  /**
   * Rodar manualmente a rotina de overdue/gerar faturas (útil para debug).
   * Protegido por permissão de admin de contratos.
   */
  @Post('_tasks/run-overdue-scan')
  @HttpCode(200)
  @RequirePermissions('contracts.admin')
  runOverdueScan() {
    return this.overdueScan.runOnce();
  }
}
