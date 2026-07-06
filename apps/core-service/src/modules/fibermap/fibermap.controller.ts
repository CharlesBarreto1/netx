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
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  AssignFibermapPortRequestSchema,
  BulkFuseRequestSchema,
  CreateFibermapCableModelRequestSchema,
  CreateFibermapCableRequestSchema,
  CreateFibermapConnectionRequestSchema,
  CreateFibermapCutRequestSchema,
  CreateFibermapDeviceRequestSchema,
  CreateFibermapElementRequestSchema,
  CreateFibermapFolderRequestSchema,
  CreateFibermapProductRequestSchema,
  CreateFibermapSegmentRequestSchema,
  CreateFibermapSlackRequestSchema,
  ConfirmFibermapKmlImportRequestSchema,
  FibermapCalibrateExcessRequestSchema,
  FibermapFiberTraceQuerySchema,
  FibermapKmlExportQuerySchema,
  FibermapKmlPreviewQuerySchema,
  FibermapOtdrLocateRequestSchema,
  FibermapPortTraceQuerySchema,
  FibermapPowerBudgetQuerySchema,
  FibermapSpliceBookQuerySchema,
  ListFibermapCablesQuerySchema,
  ListFibermapOtdrReadingsQuerySchema,
  ListFibermapReportQuerySchema,
  ListFibermapElementsQuerySchema,
  ListFibermapProductsQuerySchema,
  PatchFibermapAttenuationRequestSchema,
  PresignFibermapPhotoRequestSchema,
  RegisterFibermapPhotoRequestSchema,
  SearchFibermapCtosQuerySchema,
  SearchFibermapElementsQuerySchema,
  UpdateFibermapCableRequestSchema,
  UpdateFibermapConnectionRequestSchema,
  UpdateFibermapDeviceRequestSchema,
  UpdateFibermapElementRequestSchema,
  UpdateFibermapFolderRequestSchema,
  UpdateFibermapProductRequestSchema,
  UpdateFibermapSegmentRequestSchema,
  type AssignFibermapPortRequest,
  type AuthenticatedPrincipal,
  type BulkFuseRequest,
  type CreateFibermapCableModelRequest,
  type CreateFibermapCableRequest,
  type CreateFibermapConnectionRequest,
  type CreateFibermapCutRequest,
  type CreateFibermapDeviceRequest,
  type CreateFibermapElementRequest,
  type CreateFibermapFolderRequest,
  type CreateFibermapProductRequest,
  type CreateFibermapSegmentRequest,
  type CreateFibermapSlackRequest,
  type ConfirmFibermapKmlImportRequest,
  type FibermapCalibrateExcessRequest,
  type FibermapFiberTraceQuery,
  type FibermapKmlExportQuery,
  type FibermapKmlPreviewQuery,
  type FibermapOtdrLocateRequest,
  type FibermapPortTraceQuery,
  type FibermapPowerBudgetQuery,
  type FibermapSpliceBookQuery,
  type ListFibermapCablesQuery,
  type ListFibermapOtdrReadingsQuery,
  type ListFibermapReportQuery,
  type ListFibermapElementsQuery,
  type ListFibermapProductsQuery,
  type PatchFibermapAttenuationRequest,
  type PresignFibermapPhotoRequest,
  type RegisterFibermapPhotoRequest,
  type SearchFibermapCtosQuery,
  type SearchFibermapElementsQuery,
  type UpdateFibermapCableRequest,
  type UpdateFibermapConnectionRequest,
  type UpdateFibermapDeviceRequest,
  type UpdateFibermapElementRequest,
  type UpdateFibermapFolderRequest,
  type UpdateFibermapProductRequest,
  type UpdateFibermapSegmentRequest,
} from '@netx/shared';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { ZodBody } from '../../common/zod.pipe';
import { ZodQueryPipe } from '../crm/zod-query.pipe';
import { RequiresModule } from '../licensing/license.decorators';
import { FibermapAccessPointService } from './access-point.service';
import { FibermapAttenuationService } from './attenuation.service';
import { FibermapCablesService } from './cables.service';
import { FibermapConnectivityGraphService } from './connectivity-graph.service';
import { FibermapConnectionsService } from './connections.service';
import { FibermapCatalogService } from './catalog.service';
import { FibermapElementPhotosService } from './element-photos.service';
import { FibermapElementsService } from './elements.service';
import { FibermapFoldersService } from './folders.service';
import { FibermapKmlService } from './kml.service';
import { FibermapOtdrService } from './otdr.service';
import { FibermapPowerBudgetService } from './power-budget.service';
import { FibermapReportsService } from './reports.service';
import { FibermapSubscriberService } from './subscriber.service';

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
    private readonly accessPoint: FibermapAccessPointService,
    private readonly conns: FibermapConnectionsService,
    private readonly graph: FibermapConnectivityGraphService,
    private readonly otdr: FibermapOtdrService,
    private readonly powerBudget: FibermapPowerBudgetService,
    private readonly reports: FibermapReportsService,
    private readonly kml: FibermapKmlService,
    private readonly subscriber: FibermapSubscriberService,
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
  // Ponto de acesso + grafo lógico (FM-3, spec §8)
  // ───────────────────────────────────────────────────────────────────────
  /** Payload completo do editor de emendas — O endpoint do frontend (§6). */
  @Get('elements/:id/access-point')
  @RequirePermissions('fibermap.read')
  accessPointOf(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.accessPoint.get(u.tenantId, id);
  }

  /** Fusão/conector entre pontas livres do MESMO elemento (§14.1). */
  @Post('connections')
  @RequirePermissions('fibermap.write')
  createConnection(
    @CurrentUser() u: AuthenticatedPrincipal,
    @ZodBody(CreateFibermapConnectionRequestSchema)
    body: CreateFibermapConnectionRequest,
  ) {
    return this.conns.create(u.tenantId, u.sub, body);
  }

  /** Fusão em sequência: fibras N..N+k do cabo A nas M..M+k do B (§8.1). */
  @Post('connections/bulk-fuse')
  @RequirePermissions('fibermap.write')
  bulkFuse(
    @CurrentUser() u: AuthenticatedPrincipal,
    @ZodBody(BulkFuseRequestSchema) body: BulkFuseRequest,
  ) {
    return this.conns.bulkFuse(u.tenantId, u.sub, body);
  }

  /** Editar perda/nota (badge inline do editor). */
  @Patch('connections/:id')
  @RequirePermissions('fibermap.write')
  updateConnection(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(UpdateFibermapConnectionRequestSchema)
    body: UpdateFibermapConnectionRequest,
  ) {
    return this.conns.update(u.tenantId, u.sub, id, body);
  }

  /** Desfazer fusão — libera as pontas, preserva histórico. */
  @Delete('connections/:id')
  @RequirePermissions('fibermap.write')
  @HttpCode(204)
  async removeConnection(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.conns.remove(u.tenantId, u.sub, id);
  }

  /** Tesoura: corta fibra expressa num ponto de passagem (§4). */
  @Post('fibers/:id/cut')
  @RequirePermissions('fibermap.write')
  cutFiber(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(CreateFibermapCutRequestSchema) body: CreateFibermapCutRequest,
  ) {
    return this.conns.cut(u.tenantId, u.sub, id, body);
  }

  /** Desfaz o corte — só com as duas pontas livres (§6). */
  @Delete('cuts/:id')
  @RequirePermissions('fibermap.write')
  @HttpCode(204)
  async removeCut(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.conns.removeCut(u.tenantId, u.sub, id);
  }

  /** OLTs do inventário (/olts) + onde já estão na planta — vínculo §11. */
  @Get('olts')
  @RequirePermissions('fibermap.read')
  listInventoryOlts(@CurrentUser() u: AuthenticatedPrincipal) {
    return this.conns.listInventoryOlts(u.tenantId);
  }

  /** Splitter/DIO/OLT dentro do elemento (portas geradas, §3.5). */
  @Post('elements/:id/devices')
  @RequirePermissions('fibermap.write')
  createDevice(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(CreateFibermapDeviceRequestSchema) body: CreateFibermapDeviceRequest,
  ) {
    return this.conns.createDevice(u.tenantId, u.sub, id, body);
  }

  @Patch('devices/:id')
  @RequirePermissions('fibermap.write')
  updateDevice(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(UpdateFibermapDeviceRequestSchema) body: UpdateFibermapDeviceRequest,
  ) {
    return this.conns.updateDevice(u.tenantId, u.sub, id, body);
  }

  /** 409 com portas conectadas. */
  @Delete('devices/:id')
  @RequirePermissions('fibermap.delete')
  @HttpCode(204)
  async removeDevice(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.conns.removeDevice(u.tenantId, u.sub, id);
  }

  // ───────────────────────────────────────────────────────────────────────
  // Trace de capilar (FM-4, spec §5.1/§5.2)
  // ───────────────────────────────────────────────────────────────────────
  /** Caminhada a partir de uma ponta da fibra (A/B) ou de um corte (U/D). */
  @Get('fibers/:id/trace')
  @RequirePermissions('fibermap.read')
  traceFiber(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query(new ZodQueryPipe(FibermapFiberTraceQuerySchema))
    q: FibermapFiberTraceQuery,
  ) {
    return this.graph.traceFiber(u.tenantId, id, q);
  }

  /** Caminhada a partir de uma porta (OLT/DIO/splitter). */
  @Get('ports/:id/trace')
  @RequirePermissions('fibermap.read')
  tracePort(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query(new ZodQueryPipe(FibermapPortTraceQuerySchema))
    q: FibermapPortTraceQuery,
  ) {
    return this.graph.tracePort(u.tenantId, id, q);
  }

  // ───────────────────────────────────────────────────────────────────────
  // Import/export KML (FM-7, spec §12) — preview/commit síncrono (decisão nº7)
  // ───────────────────────────────────────────────────────────────────────
  /** KML 2.2 (Google Earth) como JSON {fileName, kml} — client baixa Blob. */
  @Get('export/kml')
  @RequirePermissions('fibermap.read')
  exportKml(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Query(new ZodQueryPipe(FibermapKmlExportQuerySchema))
    q: FibermapKmlExportQuery,
  ) {
    return this.kml.exportKml(u.tenantId, q);
  }

  /** Parse do .kml/.kmz → o que SERIA criado (nada é gravado ainda). */
  @Post('import/kml/preview')
  @RequirePermissions('fibermap.write')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 20 * 1024 * 1024 }, // migração Tomodat cabe folgado
    }),
  )
  previewKml(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Query(new ZodQueryPipe(FibermapKmlPreviewQuerySchema))
    q: FibermapKmlPreviewQuery,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    if (!file) throw new BadRequestException('Anexe um arquivo .kml ou .kmz');
    return this.kml.parsePreview(u.tenantId, q.folderId, file.buffer);
  }

  /** Cria elementos/cabos por item (snap ≤ 25 m ou POLE automático). */
  @Post('import/kml/confirm')
  @RequirePermissions('fibermap.write')
  confirmKml(
    @CurrentUser() u: AuthenticatedPrincipal,
    @ZodBody(ConfirmFibermapKmlImportRequestSchema)
    body: ConfirmFibermapKmlImportRequest,
  ) {
    return this.kml.commitImport(u.tenantId, u.sub, body);
  }

  // ───────────────────────────────────────────────────────────────────────
  // Power budget + relatórios (FM-6, spec §5.4/§6)
  // ───────────────────────────────────────────────────────────────────────
  /** dBm esperado em cada evento/ponta a partir da porta (OLT) — §5.4. */
  @Get('ports/:id/power-budget')
  @RequirePermissions('fibermap.read')
  portPowerBudget(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query(new ZodQueryPipe(FibermapPowerBudgetQuerySchema))
    q: FibermapPowerBudgetQuery,
  ) {
    return this.powerBudget.budget(u.tenantId, id, q);
  }

  @Get('reports/cto-occupancy')
  @RequirePermissions('fibermap.read')
  reportCtoOccupancy(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Query(new ZodQueryPipe(ListFibermapReportQuerySchema))
    q: ListFibermapReportQuery,
  ) {
    return this.reports.ctoOccupancy(u.tenantId, q);
  }

  /** Caderno de emendas do elemento (spec §6). */
  @Get('reports/splice-book')
  @RequirePermissions('fibermap.read')
  reportSpliceBook(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Query(new ZodQueryPipe(FibermapSpliceBookQuerySchema))
    q: FibermapSpliceBookQuery,
  ) {
    return this.reports.spliceBook(u.tenantId, q.elementId);
  }

  @Get('reports/cable-usage')
  @RequirePermissions('fibermap.read')
  reportCableUsage(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Query(new ZodQueryPipe(ListFibermapReportQuerySchema))
    q: ListFibermapReportQuery,
  ) {
    return this.reports.cableUsage(u.tenantId, q);
  }

  // ───────────────────────────────────────────────────────────────────────
  // Assinante ↔ planta (spec §11 — picker CTO/porta do cadastro/instalação)
  // ───────────────────────────────────────────────────────────────────────
  /** CTOs com ocupação — busca por nome e/ou proximidade (picker passo 1). */
  @Get('ctos')
  @RequirePermissions('fibermap.read')
  searchCtos(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Query(new ZodQueryPipe(SearchFibermapCtosQuerySchema))
    q: SearchFibermapCtosQuery,
  ) {
    return this.subscriber.searchCtos(u.tenantId, q);
  }

  /** Portas de drop da CTO com status FREE/CONNECTED/ASSIGNED (passo 2). */
  @Get('ctos/:elementId/ports')
  @RequirePermissions('fibermap.read')
  listCtoPorts(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('elementId', new ParseUUIDPipe()) elementId: string,
  ) {
    return this.subscriber.listCtoPorts(u.tenantId, elementId);
  }

  /** Vincula a porta de drop ao contrato (contracts.fibermap_port_id). */
  @Post('ports/:id/assign-contract')
  @RequirePermissions('contracts.write')
  assignPortToContract(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(AssignFibermapPortRequestSchema) body: AssignFibermapPortRequest,
  ) {
    return this.subscriber.assignPort(u.tenantId, u.sub, id, body.contractId);
  }

  /** Libera a porta do contrato (no-op sem vínculo). */
  @Post('contracts/:contractId/release-port')
  @RequirePermissions('contracts.write')
  @HttpCode(204)
  async releaseContractPort(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('contractId', new ParseUUIDPipe()) contractId: string,
  ) {
    await this.subscriber.releaseByContract(u.tenantId, u.sub, contractId);
  }

  /** Referência resolvida da porta do contrato (CTO, device, nº) — ou null. */
  @Get('contracts/:contractId/port')
  @RequirePermissions('fibermap.read')
  contractPortRef(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('contractId', new ParseUUIDPipe()) contractId: string,
  ) {
    return this.subscriber.getContractPortRef(u.tenantId, contractId);
  }

  /** Calibração OTDR: ajusta o excess_factor da INSTÂNCIA (§5.5.8/§14.10). */
  @Post('cables/:id/calibrate-excess')
  @RequirePermissions('fibermap.write')
  calibrateExcess(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(FibermapCalibrateExcessRequestSchema)
    body: FibermapCalibrateExcessRequest,
  ) {
    return this.cables.calibrateExcess(u.tenantId, u.sub, id, body);
  }

  // ───────────────────────────────────────────────────────────────────────
  // OTDR (FM-5, spec §5.5)
  // ───────────────────────────────────────────────────────────────────────
  /** Distância OTDR → coordenada do evento + incerteza; persiste a leitura. */
  @Post('otdr/locate')
  @RequirePermissions('fibermap.write')
  otdrLocate(
    @CurrentUser() u: AuthenticatedPrincipal,
    @ZodBody(FibermapOtdrLocateRequestSchema) body: FibermapOtdrLocateRequest,
  ) {
    return this.otdr.locate(u.tenantId, u.sub, body);
  }

  /** Histórico de leituras (log — nomes resolvidos best-effort). */
  @Get('otdr/readings')
  @RequirePermissions('fibermap.read')
  otdrReadings(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Query(new ZodQueryPipe(ListFibermapOtdrReadingsQuerySchema))
    q: ListFibermapOtdrReadingsQuery,
  ) {
    return this.otdr.listReadings(u.tenantId, q);
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
