/**
 * FibermapController — REST do módulo FiberMap (FIBERMAP-SPEC.md §6).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * FM-0: pastas + catálogo de produtos + defaults de atenuação. Elementos,
 * cabos, conexões, trace, OTDR e power budget entram nas fases FM-1..FM-6.
 *
 * Permissões (catálogo em prisma/seed.ts):
 *   fibermap.read   — leitura de tudo
 *   fibermap.write  — desenhar planta (pastas, elementos, cabos, fusões)
 *   fibermap.delete — exclusões
 *   fibermap.admin  — catálogo de produtos + parâmetros (Tela 3)
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
  CreateFibermapCableModelRequestSchema,
  CreateFibermapFolderRequestSchema,
  CreateFibermapProductRequestSchema,
  ListFibermapProductsQuerySchema,
  PatchFibermapAttenuationRequestSchema,
  UpdateFibermapFolderRequestSchema,
  UpdateFibermapProductRequestSchema,
  type AuthenticatedPrincipal,
  type CreateFibermapCableModelRequest,
  type CreateFibermapFolderRequest,
  type CreateFibermapProductRequest,
  type ListFibermapProductsQuery,
  type PatchFibermapAttenuationRequest,
  type UpdateFibermapFolderRequest,
  type UpdateFibermapProductRequest,
} from '@netx/shared';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { ZodBody } from '../../common/zod.pipe';
import { ZodQueryPipe } from '../crm/zod-query.pipe';
import { RequiresModule } from '../licensing/license.decorators';
import { FibermapAttenuationService } from './attenuation.service';
import { FibermapCatalogService } from './catalog.service';
import { FibermapFoldersService } from './folders.service';

@ApiTags('fibermap')
@ApiBearerAuth()
@RequiresModule('netx-fibermap')
@Controller('fibermap')
export class FibermapController {
  constructor(
    private readonly folders: FibermapFoldersService,
    private readonly catalog: FibermapCatalogService,
    private readonly attenuation: FibermapAttenuationService,
  ) {}

  // ───────────────────────────────────────────────────────────────────────
  // Pastas (spec §3.1, §6)
  // ───────────────────────────────────────────────────────────────────────
  @Get('folders')
  @RequirePermissions('fibermap.read')
  listFolders(@CurrentUser() u: AuthenticatedPrincipal) {
    return this.folders.list(u.tenantId);
  }

  @Post('folders')
  @RequirePermissions('fibermap.write')
  createFolder(
    @CurrentUser() u: AuthenticatedPrincipal,
    @ZodBody(CreateFibermapFolderRequestSchema) body: CreateFibermapFolderRequest,
  ) {
    return this.folders.create(u.tenantId, u.sub, body);
  }

  @Patch('folders/:id')
  @RequirePermissions('fibermap.write')
  updateFolder(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(UpdateFibermapFolderRequestSchema) body: UpdateFibermapFolderRequest,
  ) {
    return this.folders.update(u.tenantId, u.sub, id, body);
  }

  /** DELETE só com pasta vazia (spec §6). */
  @Delete('folders/:id')
  @RequirePermissions('fibermap.delete')
  @HttpCode(204)
  async removeFolder(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.folders.remove(u.tenantId, u.sub, id);
  }

  // ───────────────────────────────────────────────────────────────────────
  // Catálogo de produtos (Tela 3, spec §6 "Catalog")
  // ───────────────────────────────────────────────────────────────────────
  @Get('catalog/products')
  @RequirePermissions('fibermap.read')
  listProducts(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Query(new ZodQueryPipe(ListFibermapProductsQuerySchema))
    q: ListFibermapProductsQuery,
  ) {
    return this.catalog.list(u.tenantId, q);
  }

  @Get('catalog/products/:id')
  @RequirePermissions('fibermap.read')
  findProduct(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.catalog.findById(u.tenantId, id);
  }

  @Get('catalog/products/:id/instances-count')
  @RequirePermissions('fibermap.read')
  async instancesCount(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    // 404 se não existe (findById valida); count é derivado do vivo.
    await this.catalog.findById(u.tenantId, id);
    return { count: await this.catalog.instancesCount(u.tenantId, id) };
  }

  /** Categorias não-cabo (CEO/CTO/DIO/armário/rack/splitter). */
  @Post('catalog/products')
  @RequirePermissions('fibermap.admin')
  createProduct(
    @CurrentUser() u: AuthenticatedPrincipal,
    @ZodBody(CreateFibermapProductRequestSchema)
    body: CreateFibermapProductRequest,
  ) {
    return this.catalog.createProduct(u.tenantId, u.sub, body);
  }

  /** Cabo: produto + estrutura + esquema de tubos (gera cores, spec §3.2). */
  @Post('catalog/cable-models')
  @RequirePermissions('fibermap.admin')
  createCableModel(
    @CurrentUser() u: AuthenticatedPrincipal,
    @ZodBody(CreateFibermapCableModelRequestSchema)
    body: CreateFibermapCableModelRequest,
  ) {
    return this.catalog.createCableModel(u.tenantId, u.sub, body);
  }

  @Patch('catalog/products/:id')
  @RequirePermissions('fibermap.admin')
  updateProduct(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(UpdateFibermapProductRequestSchema)
    body: UpdateFibermapProductRequest,
  ) {
    return this.catalog.updateProduct(u.tenantId, u.sub, id, body);
  }

  @Post('catalog/products/:id/deactivate')
  @RequirePermissions('fibermap.admin')
  deactivateProduct(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.catalog.setActive(u.tenantId, u.sub, id, false);
  }

  @Post('catalog/products/:id/activate')
  @RequirePermissions('fibermap.admin')
  activateProduct(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.catalog.setActive(u.tenantId, u.sub, id, true);
  }

  /** 409 se houver instâncias em campo (spec §6). */
  @Delete('catalog/products/:id')
  @RequirePermissions('fibermap.admin')
  @HttpCode(204)
  async removeProduct(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.catalog.remove(u.tenantId, u.sub, id);
  }

  // ───────────────────────────────────────────────────────────────────────
  // Parâmetros (spec §6 "Config", §5.3)
  // ───────────────────────────────────────────────────────────────────────
  @Get('settings/attenuation-defaults')
  @RequirePermissions('fibermap.read')
  getAttenuation(@CurrentUser() u: AuthenticatedPrincipal) {
    return this.attenuation.get(u.tenantId);
  }

  @Patch('settings/attenuation-defaults')
  @RequirePermissions('fibermap.admin')
  patchAttenuation(
    @CurrentUser() u: AuthenticatedPrincipal,
    @ZodBody(PatchFibermapAttenuationRequestSchema)
    body: PatchFibermapAttenuationRequest,
  ) {
    return this.attenuation.patch(u.tenantId, u.sub, body);
  }
}
