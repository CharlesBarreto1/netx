/**
 * OpticalController — REST endpoints pra caixas ópticas e portas (R2 OSP).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Permissão reutiliza `network.*` (mesma família de admin de planta física).
 * Não criamos `optical.*` separado pra não fragmentar mental model — quem
 * mexe em CTO geralmente é o mesmo perfil que mexe em POP/Equipment.
 */
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
  CreateFiberCableRequestSchema,
  CreateOpticalEnclosureRequestSchema,
  ListFiberCablesQuerySchema,
  ListOpticalEnclosuresQuerySchema,
  UpdateFiberCableRequestSchema,
  UpdateOpticalEnclosureRequestSchema,
  UpdateOpticalPortRequestSchema,
  type AuthenticatedPrincipal,
  type CreateFiberCableRequest,
  type CreateOpticalEnclosureRequest,
  type ListFiberCablesQuery,
  type ListOpticalEnclosuresQuery,
  type UpdateFiberCableRequest,
  type UpdateOpticalEnclosureRequest,
  type UpdateOpticalPortRequest,
} from '@netx/shared';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { ZodBody } from '../../common/zod.pipe';
import { ZodQueryPipe } from '../crm/zod-query.pipe';
import { FiberCablesService } from './fiber-cables.service';
import { OpticalEnclosuresService } from './optical-enclosures.service';

@ApiTags('optical')
@ApiBearerAuth()
@Controller('optical')
export class OpticalController {
  constructor(
    private readonly enclosures: OpticalEnclosuresService,
    private readonly fiberCables: FiberCablesService,
  ) {}

  // ───────────────────────────────────────────────────────────────────────
  // Enclosures
  // ───────────────────────────────────────────────────────────────────────
  @Get('enclosures')
  @RequirePermissions('network.read')
  list(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Query(new ZodQueryPipe(ListOpticalEnclosuresQuerySchema))
    q: ListOpticalEnclosuresQuery,
  ) {
    return this.enclosures.list(u.tenantId, q);
  }

  @Get('enclosures/:id')
  @RequirePermissions('network.read')
  findById(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.enclosures.findById(u.tenantId, id);
  }

  @Post('enclosures')
  @RequirePermissions('network.write')
  create(
    @CurrentUser() u: AuthenticatedPrincipal,
    @ZodBody(CreateOpticalEnclosureRequestSchema)
    body: CreateOpticalEnclosureRequest,
  ) {
    return this.enclosures.create(u.tenantId, u.sub, body);
  }

  @Patch('enclosures/:id')
  @RequirePermissions('network.write')
  update(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(UpdateOpticalEnclosureRequestSchema)
    body: UpdateOpticalEnclosureRequest,
  ) {
    return this.enclosures.update(u.tenantId, u.sub, id, body);
  }

  @Delete('enclosures/:id')
  @HttpCode(204)
  @RequirePermissions('network.delete')
  async remove(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.enclosures.remove(u.tenantId, u.sub, id);
  }

  // ───────────────────────────────────────────────────────────────────────
  // Portas
  // ───────────────────────────────────────────────────────────────────────
  @Get('enclosures/:id/ports')
  @RequirePermissions('network.read')
  listPorts(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.enclosures.listPorts(u.tenantId, id);
  }

  @Patch('ports/:portId')
  @RequirePermissions('network.write')
  updatePort(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('portId', new ParseUUIDPipe()) portId: string,
    @ZodBody(UpdateOpticalPortRequestSchema) body: UpdateOpticalPortRequest,
  ) {
    return this.enclosures.updatePort(u.tenantId, u.sub, portId, body);
  }

  // ───────────────────────────────────────────────────────────────────────
  // Cabos de fibra (R3)
  // ───────────────────────────────────────────────────────────────────────
  @Get('cables')
  @RequirePermissions('network.read')
  listCables(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Query(new ZodQueryPipe(ListFiberCablesQuerySchema))
    q: ListFiberCablesQuery,
  ) {
    return this.fiberCables.list(u.tenantId, q);
  }

  @Get('cables/:id')
  @RequirePermissions('network.read')
  getCable(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.fiberCables.findById(u.tenantId, id);
  }

  @Post('cables')
  @RequirePermissions('network.write')
  createCable(
    @CurrentUser() u: AuthenticatedPrincipal,
    @ZodBody(CreateFiberCableRequestSchema) body: CreateFiberCableRequest,
  ) {
    return this.fiberCables.create(u.tenantId, u.sub, body);
  }

  @Patch('cables/:id')
  @RequirePermissions('network.write')
  updateCable(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(UpdateFiberCableRequestSchema) body: UpdateFiberCableRequest,
  ) {
    return this.fiberCables.update(u.tenantId, u.sub, id, body);
  }

  @Delete('cables/:id')
  @HttpCode(204)
  @RequirePermissions('network.delete')
  async removeCable(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.fiberCables.remove(u.tenantId, u.sub, id);
  }
}
