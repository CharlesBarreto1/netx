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
  CreateFibermapCableRequestSchema,
  CreateFibermapElementRequestSchema,
  CreateFibermapFolderRequestSchema,
  CreateFibermapProductRequestSchema,
  CreateFibermapSegmentRequestSchema,
  CreateFibermapSlackRequestSchema,
  ListFibermapCablesQuerySchema,
  ListFibermapElementsQuerySchema,
  ListFibermapProductsQuerySchema,
  PatchFibermapAttenuationRequestSchema,
  PresignFibermapPhotoRequestSchema,
  RegisterFibermapPhotoRequestSchema,
  SearchFibermapElementsQuerySchema,
  UpdateFibermapCableRequestSchema,
  UpdateFibermapElementRequestSchema,
  UpdateFibermapFolderRequestSchema,
  UpdateFibermapProductRequestSchema,
  UpdateFibermapSegmentRequestSchema,
  type AuthenticatedPrincipal,
  type CreateFibermapCableModelRequest,
  type CreateFibermapCableRequest,
  type CreateFibermapElementRequest,
  type CreateFibermapFolderRequest,
  type CreateFibermapProductRequest,
  type CreateFibermapSegmentRequest,
  type CreateFibermapSlackRequest,
  type ListFibermapCablesQuery,
  type ListFibermapElementsQuery,
  type ListFibermapProductsQuery,
  type PatchFibermapAttenuationRequest,
  type PresignFibermapPhotoRequest,
  type RegisterFibermapPhotoRequest,
  type SearchFibermapElementsQuery,
  type UpdateFibermapCableRequest,
  type UpdateFibermapElementRequest,
  type UpdateFibermapFolderRequest,
  type UpdateFibermapProductRequest,
  type UpdateFibermapSegmentRequest,
} from '@netx/shared';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { ZodBody } from '../../common/zod.pipe';
import { ZodQueryPipe } from '../crm/zod-query.pipe';
import { RequiresModule } from '../licensing/license.decorators';
import { FibermapAttenuationService } from './attenuation.service';
import { FibermapCablesService } from './cables.service';
import { FibermapCatalogService } from './catalog.service';
import { FibermapElementPhotosService } from './element-photos.service';
import { FibermapElementsService } from './elements.service';
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
    private readonly elements: FibermapElementsService,
    private readonly photos: FibermapElementPhotosService,
    private readonly cables: FibermapCablesService,
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

  /** Conteúdo da pasta pra árvore do painel (elementos + cabos). */
  @Get('folders/:id/contents')
  @RequirePermissions('fibermap.read')
  folderContents(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.folders.listContents(u.tenantId, id);
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
  // Elementos (mapa por bbox + CRUD + busca, spec §3.3/§6)
  // ───────────────────────────────────────────────────────────────────────
  /** GeoJSON FeatureCollection do viewport — SEMPRE com bbox (spec §6). */
  @Get('elements')
  @RequirePermissions('fibermap.read')
  listElements(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Query(new ZodQueryPipe(ListFibermapElementsQuerySchema))
    q: ListFibermapElementsQuery,
  ) {
    return this.elements.listGeoJson(u.tenantId, q);
  }

  /** Autocomplete por nome (painel esquerdo — voar até o elemento). */
  @Get('elements/search')
  @RequirePermissions('fibermap.read')
  searchElements(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Query(new ZodQueryPipe(SearchFibermapElementsQuerySchema))
    q: SearchFibermapElementsQuery,
  ) {
    return this.elements.search(u.tenantId, q);
  }

  @Get('elements/:id')
  @RequirePermissions('fibermap.read')
  findElement(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.elements.findById(u.tenantId, id);
  }

  @Post('elements')
  @RequirePermissions('fibermap.write')
  createElement(
    @CurrentUser() u: AuthenticatedPrincipal,
    @ZodBody(CreateFibermapElementRequestSchema)
    body: CreateFibermapElementRequest,
  ) {
    return this.elements.create(u.tenantId, u.sub, body);
  }

  @Patch('elements/:id')
  @RequirePermissions('fibermap.write')
  updateElement(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(UpdateFibermapElementRequestSchema)
    body: UpdateFibermapElementRequest,
  ) {
    return this.elements.update(u.tenantId, u.sub, id, body);
  }

  /** 409 se o elemento tem cabos/devices/conexões (spec §14.2). */
  @Delete('elements/:id')
  @RequirePermissions('fibermap.delete')
  @HttpCode(204)
  async removeElement(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.elements.remove(u.tenantId, u.sub, id);
  }

  // Fotos (MinIO presigned, 2 passos)
  @Post('elements/:id/photos/presign')
  @RequirePermissions('fibermap.write')
  presignPhoto(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(PresignFibermapPhotoRequestSchema)
    body: PresignFibermapPhotoRequest,
  ) {
    return this.photos.presign(u.tenantId, id, body);
  }

  @Post('elements/:id/photos')
  @RequirePermissions('fibermap.write')
  registerPhoto(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(RegisterFibermapPhotoRequestSchema)
    body: RegisterFibermapPhotoRequest,
  ) {
    return this.photos.register(u.tenantId, u.sub, id, body);
  }

  @Get('elements/:id/photos/:photoId/download')
  @RequirePermissions('fibermap.read')
  photoDownload(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('photoId', new ParseUUIDPipe()) photoId: string,
  ) {
    return this.photos.downloadUrl(u.tenantId, id, photoId);
  }

  @Delete('elements/:id/photos/:photoId')
  @RequirePermissions('fibermap.write')
  @HttpCode(204)
  async removePhoto(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('photoId', new ParseUUIDPipe()) photoId: string,
  ) {
    await this.photos.remove(u.tenantId, u.sub, id, photoId);
  }

  // ───────────────────────────────────────────────────────────────────────
  // Cabos, segmentos e reservas (FM-2, spec §3.4/§6 "Cables")
  // ───────────────────────────────────────────────────────────────────────
  /** FeatureCollection<LineString> por segmento — mesmo contrato bbox. */
  @Get('cables')
  @RequirePermissions('fibermap.read')
  listCables(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Query(new ZodQueryPipe(ListFibermapCablesQuerySchema))
    q: ListFibermapCablesQuery,
  ) {
    return this.cables.listGeoJson(u.tenantId, q);
  }

  /** Cabos que podem CONTINUAR a partir de um elemento (ponta solta/final). */
  @Get('cables/ending-at/:elementId')
  @RequirePermissions('fibermap.read')
  cablesEndingAt(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('elementId', new ParseUUIDPipe()) elementId: string,
  ) {
    return this.cables.stubsEndingAt(u.tenantId, elementId);
  }

  @Get('cables/:id')
  @RequirePermissions('fibermap.read')
  findCable(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.cables.findById(u.tenantId, id);
  }

  /** Instancia do modelo do catálogo (tubos+fibras automáticos, spec §6). */
  @Post('cables')
  @RequirePermissions('fibermap.write')
  createCable(
    @CurrentUser() u: AuthenticatedPrincipal,
    @ZodBody(CreateFibermapCableRequestSchema) body: CreateFibermapCableRequest,
  ) {
    return this.cables.create(u.tenantId, u.sub, body);
  }

  @Patch('cables/:id')
  @RequirePermissions('fibermap.write')
  updateCable(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(UpdateFibermapCableRequestSchema) body: UpdateFibermapCableRequest,
  ) {
    return this.cables.update(u.tenantId, u.sub, id, body);
  }

  /** 409 com fusões/cortes ativos (spec §14.2). */
  @Delete('cables/:id')
  @RequirePermissions('fibermap.delete')
  @HttpCode(204)
  async removeCable(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.cables.remove(u.tenantId, u.sub, id);
  }

  /** Novo trecho na ponta da cadeia (contiguidade validada, spec §14.4). */
  @Post('cables/:id/segments')
  @RequirePermissions('fibermap.write')
  addSegment(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(CreateFibermapSegmentRequestSchema)
    body: CreateFibermapSegmentRequest,
  ) {
    return this.cables.addSegment(u.tenantId, u.sub, id, body);
  }

  @Patch('segments/:id')
  @RequirePermissions('fibermap.write')
  updateSegment(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(UpdateFibermapSegmentRequestSchema)
    body: UpdateFibermapSegmentRequest,
  ) {
    return this.cables.updateSegment(u.tenantId, u.sub, id, body);
  }

  @Delete('segments/:id')
  @RequirePermissions('fibermap.write')
  removeSegment(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.cables.removeSegment(u.tenantId, u.sub, id);
  }

  /** Reserva técnica na ponta de um segmento (soma na distância óptica). */
  @Post('cables/:id/slacks')
  @RequirePermissions('fibermap.write')
  addSlack(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(CreateFibermapSlackRequestSchema) body: CreateFibermapSlackRequest,
  ) {
    return this.cables.addSlack(u.tenantId, u.sub, id, body);
  }

  @Delete('slacks/:id')
  @RequirePermissions('fibermap.write')
  removeSlack(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.cables.removeSlack(u.tenantId, u.sub, id);
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
