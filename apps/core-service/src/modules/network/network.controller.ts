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
  NetworkEquipmentType,
  NetworkEquipmentVendor,
} from '@prisma/client';
import {
  CreateNetworkEquipmentRequestSchema,
  CreateNetworkPopRequestSchema,
  UpdateNetworkEquipmentRequestSchema,
  UpdateNetworkPopRequestSchema,
  type AuthenticatedPrincipal,
  type CreateNetworkEquipmentRequest,
  type CreateNetworkPopRequest,
  type UpdateNetworkEquipmentRequest,
  type UpdateNetworkPopRequest,
} from '@netx/shared';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { ZodBody } from '../../common/zod.pipe';
import {
  NetworkEquipmentService,
  type CreateEquipmentInput,
  type UpdateEquipmentInput,
} from './network-equipment.service';
import { NetworkPopsService } from './network-pops.service';

@ApiTags('network')
@ApiBearerAuth()
@Controller('network')
export class NetworkController {
  constructor(
    private readonly pops: NetworkPopsService,
    private readonly equipment: NetworkEquipmentService,
  ) {}

  // ───────────────────────────────────────────────────────────────────────
  // POPs
  // ───────────────────────────────────────────────────────────────────────
  @Get('pops')
  @RequirePermissions('network.read')
  listPops(@CurrentUser() u: AuthenticatedPrincipal) {
    return this.pops.list(u.tenantId);
  }

  @Get('pops/:id')
  @RequirePermissions('network.read')
  getPop(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.pops.findById(u.tenantId, id);
  }

  @Post('pops')
  @RequirePermissions('network.write')
  createPop(
    @CurrentUser() u: AuthenticatedPrincipal,
    @ZodBody(CreateNetworkPopRequestSchema) body: CreateNetworkPopRequest,
  ) {
    return this.pops.create(u.tenantId, u.sub, body);
  }

  @Patch('pops/:id')
  @RequirePermissions('network.write')
  updatePop(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(UpdateNetworkPopRequestSchema) body: UpdateNetworkPopRequest,
  ) {
    return this.pops.update(u.tenantId, u.sub, id, body);
  }

  @Delete('pops/:id')
  @HttpCode(204)
  @RequirePermissions('network.delete')
  async deletePop(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.pops.remove(u.tenantId, u.sub, id);
  }

  // ───────────────────────────────────────────────────────────────────────
  // Equipamentos
  // ───────────────────────────────────────────────────────────────────────
  @Get('equipment')
  @RequirePermissions('network.read')
  listEquipment(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Query('type') type?: string,
    @Query('popId') popId?: string,
  ) {
    return this.equipment.list(u.tenantId, {
      type: type ? (type.toUpperCase() as NetworkEquipmentType) : undefined,
      popId,
    });
  }

  @Get('equipment/:id')
  @RequirePermissions('network.read')
  getEquipment(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.equipment.findById(u.tenantId, id);
  }

  @Post('equipment')
  @RequirePermissions('network.write')
  createEquipment(
    @CurrentUser() u: AuthenticatedPrincipal,
    @ZodBody(CreateNetworkEquipmentRequestSchema) body: CreateNetworkEquipmentRequest,
  ) {
    // Normalização leve de enums: Zod já valida o set permitido, isto é só
    // pra aceitar variações de case que o frontend possa mandar.
    const normalized: CreateEquipmentInput = {
      ...body,
      type: (body.type as string).toUpperCase() as NetworkEquipmentType,
      vendor: body.vendor
        ? ((body.vendor as string).toUpperCase() as NetworkEquipmentVendor)
        : undefined,
    };
    return this.equipment.create(u.tenantId, u.sub, normalized);
  }

  @Patch('equipment/:id')
  @RequirePermissions('network.write')
  updateEquipment(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(UpdateNetworkEquipmentRequestSchema) body: UpdateNetworkEquipmentRequest,
  ) {
    const normalized: UpdateEquipmentInput = {
      ...body,
      ...(body.type
        ? { type: (body.type as string).toUpperCase() as NetworkEquipmentType }
        : {}),
      ...(body.vendor
        ? { vendor: (body.vendor as string).toUpperCase() as NetworkEquipmentVendor }
        : {}),
    };
    return this.equipment.update(u.tenantId, u.sub, id, normalized);
  }

  @Delete('equipment/:id')
  @HttpCode(204)
  @RequirePermissions('network.delete')
  async deleteEquipment(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.equipment.remove(u.tenantId, u.sub, id);
  }

  /**
   * Operação de manutenção: força resync de TODOS BNGs ativos pra
   * radius.nas. Útil após restore de backup ou se admin suspeitar
   * de drift.
   */
  @Post('equipment/_resync-bngs')
  @HttpCode(200)
  @RequirePermissions('network.write')
  resyncBngs(@CurrentUser() u: AuthenticatedPrincipal) {
    return this.equipment.resyncAllBngs(u.tenantId, u.sub);
  }

  /**
   * Testa conectividade nas strategies disponíveis pra esse equipamento.
   * Não derruba sessões — só valida credenciais e canal:
   *   - CoA: manda Disconnect com User-Name fictício, espera NAK
   *   - Mikrotik API: connect + /system/identity/print
   *   - SSH: connect + echo
   */
  @Post('equipment/:id/test-connection')
  @HttpCode(200)
  @RequirePermissions('network.write')
  testConnection(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id') id: string,
  ) {
    return this.equipment.testConnection(u.tenantId, u.sub, id);
  }
}
