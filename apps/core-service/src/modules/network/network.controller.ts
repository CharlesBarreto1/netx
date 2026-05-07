import {
  Body,
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
import type { AuthenticatedPrincipal } from '@netx/shared';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import {
  NetworkEquipmentService,
  type CreateEquipmentInput,
  type UpdateEquipmentInput,
} from './network-equipment.service';
import {
  NetworkPopsService,
  type CreatePopInput,
  type UpdatePopInput,
} from './network-pops.service';

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
    @Body() body: CreatePopInput,
  ) {
    return this.pops.create(u.tenantId, u.sub, body);
  }

  @Patch('pops/:id')
  @RequirePermissions('network.write')
  updatePop(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdatePopInput,
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
    @Body() body: CreateEquipmentInput,
  ) {
    // Normalização leve de enums: aceita lowercase e converte
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
    @Body() body: UpdateEquipmentInput,
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
}
