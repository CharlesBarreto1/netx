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
  BadRequestException,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  AssignItemsToFolderRequestSchema,
  CalculatePowerBudgetRequestSchema,
  ConfirmKmlImportRequestSchema,
  CreateFiberCableRequestSchema,
  CreateFiberSpliceRequestSchema,
  CreateNetworkFolderRequestSchema,
  CreateOpticalEnclosureRequestSchema,
  ListFiberCablesQuerySchema,
  ListFiberSplicesQuerySchema,
  ListOpticalEnclosuresQuerySchema,
  UpdateFiberCableRequestSchema,
  UpdateFiberSpliceRequestSchema,
  UpdateNetworkFolderRequestSchema,
  UpdateOpticalEnclosureRequestSchema,
  UpdateOpticalPortRequestSchema,
  type AssignItemsToFolderRequest,
  type AuthenticatedPrincipal,
  type CalculatePowerBudgetRequest,
  type ConfirmKmlImportRequest,
  type CreateFiberCableRequest,
  type CreateFiberSpliceRequest,
  type CreateNetworkFolderRequest,
  type CreateOpticalEnclosureRequest,
  type ListFiberCablesQuery,
  type ListFiberSplicesQuery,
  type ListOpticalEnclosuresQuery,
  type UpdateFiberCableRequest,
  type UpdateFiberSpliceRequest,
  type UpdateNetworkFolderRequest,
  type UpdateOpticalEnclosureRequest,
  type UpdateOpticalPortRequest,
} from '@netx/shared';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { ZodBody } from '../../common/zod.pipe';
import { ZodQueryPipe } from '../crm/zod-query.pipe';
import { EnclosureTopologyService } from './enclosure-topology.service';
import { FiberCablesService } from './fiber-cables.service';
import { FiberSplicesService } from './fiber-splices.service';
import { KmlService } from './kml.service';
import { NetworkFoldersService } from './network-folders.service';
import { OpticalEnclosuresService } from './optical-enclosures.service';
import { PowerBudgetService } from './power-budget.service';

@ApiTags('optical')
@ApiBearerAuth()
@Controller('optical')
export class OpticalController {
  constructor(
    private readonly enclosures: OpticalEnclosuresService,
    private readonly fiberCables: FiberCablesService,
    private readonly fiberSplices: FiberSplicesService,
    private readonly topology: EnclosureTopologyService,
    private readonly powerBudget: PowerBudgetService,
    private readonly kml: KmlService,
    private readonly folders: NetworkFoldersService,
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

  /**
   * Snapshot agregado pra vista esquemática (R4.5b). 1 request retorna
   * tudo que a UI precisa renderizar dentro de uma caixa.
   */
  @Get('enclosures/:id/topology')
  @RequirePermissions('network.read')
  getTopology(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.topology.getTopology(u.tenantId, id);
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

  // ───────────────────────────────────────────────────────────────────────
  // Fusões / emendas (R4)
  // ───────────────────────────────────────────────────────────────────────
  @Get('splices')
  @RequirePermissions('network.read')
  listSplices(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Query(new ZodQueryPipe(ListFiberSplicesQuerySchema))
    q: ListFiberSplicesQuery,
  ) {
    return this.fiberSplices.list(u.tenantId, q);
  }

  @Get('splices/:id')
  @RequirePermissions('network.read')
  getSplice(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.fiberSplices.findById(u.tenantId, id);
  }

  @Post('splices')
  @RequirePermissions('network.write')
  createSplice(
    @CurrentUser() u: AuthenticatedPrincipal,
    @ZodBody(CreateFiberSpliceRequestSchema) body: CreateFiberSpliceRequest,
  ) {
    return this.fiberSplices.create(u.tenantId, u.sub, body);
  }

  @Patch('splices/:id')
  @RequirePermissions('network.write')
  updateSplice(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(UpdateFiberSpliceRequestSchema) body: UpdateFiberSpliceRequest,
  ) {
    return this.fiberSplices.update(u.tenantId, u.sub, id, body);
  }

  @Delete('splices/:id')
  @HttpCode(204)
  @RequirePermissions('network.delete')
  async removeSplice(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.fiberSplices.remove(u.tenantId, u.sub, id);
  }

  // ───────────────────────────────────────────────────────────────────────
  // Power budget (R5) — calculadora manual
  // ───────────────────────────────────────────────────────────────────────
  // POST porque o input é grande/estruturado; idempotente (sem efeito
  // colateral) então cache HTTP é permitido pelos clientes.
  @Post('power-budget/calculate')
  @RequirePermissions('network.read')
  calculatePowerBudget(
    @ZodBody(CalculatePowerBudgetRequestSchema)
    body: CalculatePowerBudgetRequest,
  ) {
    return this.powerBudget.calculate(body);
  }

  // ───────────────────────────────────────────────────────────────────────
  // Import / export KML/KMZ (R4.5d)
  // ───────────────────────────────────────────────────────────────────────
  /**
   * Faz parse do arquivo enviado e retorna preview. Não cria nada ainda —
   * operador confere o que SERIA criado e depois chama /confirm.
   * Aceita .kml (XML) ou .kmz (zip contendo doc.kml).
   */
  @Post('import/kml/preview')
  @RequirePermissions('network.write')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB suficiente pra plantas grandes
    }),
  )
  async previewKml(
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    if (!file) {
      throw new BadRequestException('Anexe um arquivo .kml ou .kmz');
    }
    return this.kml.parsePreview(file.buffer);
  }

  /**
   * Confirma o import: cria entidades em transação. Retorna contadores +
   * erros (item-a-item; alguns podem falhar sem desfazer o resto).
   */
  @Post('import/kml/confirm')
  @RequirePermissions('network.write')
  confirmKml(
    @CurrentUser() u: AuthenticatedPrincipal,
    @ZodBody(ConfirmKmlImportRequestSchema) body: ConfirmKmlImportRequest,
  ) {
    return this.kml.commitImport(u.tenantId, u.sub, body);
  }

  /**
   * Export da planta inteira como KML 2.2. Abre direto no Google Earth/QGIS.
   * Content-Type: application/vnd.google-earth.kml+xml.
   */
  @Get('export/kml')
  @RequirePermissions('network.read')
  @Header('Content-Type', 'application/vnd.google-earth.kml+xml')
  @Header(
    'Content-Disposition',
    'attachment; filename="netx-planta.kml"',
  )
  async exportKml(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Res() res: Response,
  ) {
    const xml = await this.kml.exportKml(u.tenantId);
    res.send(xml);
  }

  // ───────────────────────────────────────────────────────────────────────
  // Pastas (R4.5e) — organização administrativa
  // ───────────────────────────────────────────────────────────────────────
  @Get('folders')
  @RequirePermissions('network.read')
  listFolders(@CurrentUser() u: AuthenticatedPrincipal) {
    return this.folders.list(u.tenantId);
  }

  @Get('folders/:id')
  @RequirePermissions('network.read')
  getFolder(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.folders.findById(u.tenantId, id);
  }

  @Post('folders')
  @RequirePermissions('network.write')
  createFolder(
    @CurrentUser() u: AuthenticatedPrincipal,
    @ZodBody(CreateNetworkFolderRequestSchema) body: CreateNetworkFolderRequest,
  ) {
    return this.folders.create(u.tenantId, u.sub, body);
  }

  @Patch('folders/:id')
  @RequirePermissions('network.write')
  updateFolder(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(UpdateNetworkFolderRequestSchema) body: UpdateNetworkFolderRequest,
  ) {
    return this.folders.update(u.tenantId, u.sub, id, body);
  }

  @Delete('folders/:id')
  @HttpCode(204)
  @RequirePermissions('network.delete')
  async removeFolder(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.folders.remove(u.tenantId, u.sub, id);
  }

  /**
   * Atribui itens (caixas + cabos) a uma pasta. `id` no path é o folderId
   * destino, ou a string `unassigned` pra desatribuir (folderId = null).
   */
  @Post('folders/:id/items')
  @RequirePermissions('network.write')
  assignItems(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id') id: string,
    @ZodBody(AssignItemsToFolderRequestSchema)
    body: AssignItemsToFolderRequest,
  ) {
    const folderId = id === 'unassigned' ? null : id;
    return this.folders.assignItems(u.tenantId, u.sub, folderId, body);
  }
}
