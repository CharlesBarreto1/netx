/**
 * Controllers do módulo Provisioning:
 *   /v1/olts                          — CRUD admin de OLTs
 *   /v1/olts/:id/test-connection      — testa SSH/API via driver
 *   /v1/provisioning/pending          — contratos PENDING_INSTALL
 *   /v1/provisioning/install/:id      — ativa cliente em campo (técnico)
 *   /v1/provisioning/onts/:id/status  — poll do estado da ONT
 *   /v1/tr069/devices                 — lista devices ACS (Fase 3)
 *   /v1/tr069/devices/:id/tasks       — tasks de um device
 *   /v1/tr069/tasks/:id               — cancela task
 *
 * Permissions:
 *   olts.admin           — CRUD OLT
 *   provisioning.read    — listar pending, status ONT
 *   provisioning.write   — instalar em campo (técnico)
 *   tr069.admin          — gerenciar ACS / cancel tasks
 *
 * @provenance Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=
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
  Put,
  Query,
  Body,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  CreateOltRequestSchema,
  CreateProvisioningProfileRequestSchema,
  ListProvisioningProfilesQuerySchema,
  UpdateProvisioningProfileRequestSchema,
  CreateTr069DeviceNoteSchema,
  CreateTr069ProfileSchema,
  FirmwareUpgradeRequestSchema,
  InstallCustomerRequestSchema,
  ListOltsQuerySchema,
  ListPendingInstallsQuerySchema,
  ListTr069AlertsQuerySchema,
  ListTr069DiagnosticsQuerySchema,
  ListWifiCoverageQuerySchema,
  MigrateOltOntsRequestSchema,
  OntSwapSchema,
  PingRequestSchema,
  SetRouterSettingsSchema,
  SetWifiRadioSchema,
  SpeedTestRequestSchema,
  Tr069ProbeRequestSchema,
  AdoptPendingDeviceRequestSchema,
  Tr069FirmwareCampaignRequestSchema,
  DeployTr069FirmwareRequestSchema,
  UploadTr069FirmwareFieldsSchema,
  UpsertTr069ConfigRequestSchema,
  UpdateOltRequestSchema,
  UpdateTr069ProfileSchema,
  type DeployTr069FirmwareRequest,
  type AuthenticatedPrincipal,
  type CreateOltRequest,
  type CreateProvisioningProfileRequest,
  type ListProvisioningProfilesQuery,
  type UpdateProvisioningProfileRequest,
  type CreateTr069DeviceNote,
  type CreateTr069Profile,
  type FirmwareUpgradeRequest,
  type InstallCustomerRequest,
  type ListOltsQuery,
  type MigrateOltOntsRequest,
  type ListPendingInstallsQuery,
  type ListTr069AlertsQuery,
  type ListTr069DiagnosticsQuery,
  type ListWifiCoverageQuery,
  type OntSwap,
  type PingRequest,
  type SetRouterSettings,
  type SetWifiRadio,
  type SpeedTestRequest,
  type Tr069ProbeRequest,
  type AdoptPendingDeviceRequest,
  type Tr069FirmwareCampaignRequest,
  type UpsertTr069ConfigRequest,
  type UpdateOltRequest,
  type UpdateTr069Profile,
} from '@netx/shared';

import { z } from 'zod';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { ZodBody, ZodValidationPipe } from '../../common/zod.pipe';
import { RequiresModule } from '../licensing/license.decorators';

/** Corpo do "desfazer instalação": local onde o comodato volta. */
const DeactivateInstallSchema = z.object({
  returnLocationId: z.string().uuid(),
});

import { OltDiscoveryService } from './olt-discovery.service';
import { OltProvisioningProfilesService } from './olt-provisioning-profiles.service';
import { OltsService } from './olts.service';
import { ProvisioningService } from './provisioning.service';
import { Tr069ConfigService } from './tr069-config.service';
import { Tr069FirmwareService } from './tr069-firmware.service';
import { Tr069DiagnosticsService } from './tr069-diagnostics.service';
import { Tr069ProfilesService } from './tr069-profiles.service';
import { Tr069TasksService } from './tr069-tasks.service';

// =============================================================================
// /v1/olts — CRUD admin
// =============================================================================
@ApiTags('olts')
@ApiBearerAuth()
@RequiresModule('netx-cpe')
@Controller('olts')
export class OltsController {
  constructor(
    private readonly svc: OltsService,
    private readonly discovery: OltDiscoveryService,
  ) {}

  @Get()
  @RequirePermissions('olts.admin')
  list(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Query(new ZodValidationPipe(ListOltsQuerySchema)) q: ListOltsQuery,
  ) {
    return this.svc.list(user.tenantId, q);
  }

  @Get(':id')
  @RequirePermissions('olts.admin')
  findOne(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.svc.findById(user.tenantId, id);
  }

  @Post()
  @RequirePermissions('olts.admin')
  create(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodBody(CreateOltRequestSchema) input: CreateOltRequest,
  ) {
    return this.svc.create(user.tenantId, user.sub, input);
  }

  @Patch(':id')
  @RequirePermissions('olts.admin')
  update(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(UpdateOltRequestSchema) input: UpdateOltRequest,
  ) {
    return this.svc.update(user.tenantId, user.sub, id, input);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('olts.admin')
  async remove(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.svc.remove(user.tenantId, user.sub, id);
  }

  @Post(':id/test-connection')
  @HttpCode(200)
  @RequirePermissions('olts.admin')
  testConnection(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.svc.testConnection(user.tenantId, user.sub, id);
  }

  /**
   * Migra todas as ONTs desta OLT pra outra (rede própria). Usado pra esvaziar
   * uma OLT cadastrada errada antes de excluí-la, sem derrubar os clientes.
   */
  @Post(':id/migrate-onts')
  @HttpCode(200)
  @RequirePermissions('olts.admin')
  migrateOnts(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(MigrateOltOntsRequestSchema) body: MigrateOltOntsRequest,
  ) {
    return this.svc.migrateOnts(user.tenantId, user.sub, id, body.targetOltId);
  }

  // ── Descoberta de ONU (integrador técnico) ────────────────────────────────
  /**
   * Camada 1 — varre a OLT e grava as ONUs em staging (discovered_onts).
   * Síncrono e gentil (1 PON por vez); pode levar minutos numa OLT cheia.
   */
  @Post(':id/scan-onts')
  @HttpCode(200)
  @RequirePermissions('olts.admin')
  scanOnts(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('slot') slot?: string,
    @Query('pon') pon?: string,
  ) {
    // Piloto controlado: ?slot=X&pon=Y limita a varredura a uma PON. Sem params,
    // varre a OLT inteira.
    const scope =
      slot !== undefined && pon !== undefined
        ? { slot: Number(slot), pon: Number(pon) }
        : undefined;
    return this.discovery.scan(user.tenantId, id, { scope });
  }

  /** Camada 2 — casa as ONUs descobertas (com MAC) contra o Hubsoft. */
  @Post('discovery/match')
  @HttpCode(200)
  @RequirePermissions('olts.admin')
  matchDiscovered(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.discovery.matchAgainstHubsoft(user.tenantId);
  }

  /** Lista o staging de ONUs descobertas (para revisão). */
  @Get('discovery/onts')
  @RequirePermissions('olts.admin')
  listDiscovered(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.discovery.listDiscovered(user.tenantId);
  }

  /**
   * Camada 3 — materializa os MATCHED em Customer+Contract+Ont (reusa o import
   * Hubsoft) e enfileira RADIUS conforme o status. `?noRadius=1` materializa sem
   * tocar RADIUS; `ids` no body materializa só os selecionados (default: todos).
   */
  @Post('discovery/materialize')
  @HttpCode(200)
  @RequirePermissions('olts.admin')
  materialize(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Query('noRadius') noRadius?: string,
    @Body() body?: { ids?: string[] },
  ) {
    return this.discovery.materialize(user.tenantId, user.sub, {
      ids: body?.ids,
      enqueueRadius: noRadius !== '1' && noRadius !== 'true',
    });
  }

  /**
   * Aplica o comodato do Hubsoft aos Onts já materializados (backfill) — para
   * contratos materializados antes do import de comodato existir.
   */
  @Post('discovery/apply-comodato')
  @HttpCode(200)
  @RequirePermissions('olts.admin')
  applyComodato(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.discovery.applyComodatoToMaterialized(user.tenantId);
  }
}

// =============================================================================
// /v1/olt-provisioning-profiles — CRUD de templates de provisionamento (Fase 2)
// =============================================================================
@ApiTags('olt-provisioning-profiles')
@ApiBearerAuth()
@RequiresModule('netx-cpe')
@Controller('olt-provisioning-profiles')
export class OltProvisioningProfilesController {
  constructor(private readonly svc: OltProvisioningProfilesService) {}

  @Get()
  @RequirePermissions('olts.admin')
  list(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Query(new ZodValidationPipe(ListProvisioningProfilesQuerySchema))
    q: ListProvisioningProfilesQuery,
  ) {
    return this.svc.list(user.tenantId, q);
  }

  @Get(':id')
  @RequirePermissions('olts.admin')
  findOne(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.svc.findById(user.tenantId, id);
  }

  @Post()
  @RequirePermissions('olts.admin')
  create(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodBody(CreateProvisioningProfileRequestSchema) input: CreateProvisioningProfileRequest,
  ) {
    return this.svc.create(user.tenantId, user.sub, input);
  }

  @Patch(':id')
  @RequirePermissions('olts.admin')
  update(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(UpdateProvisioningProfileRequestSchema) input: UpdateProvisioningProfileRequest,
  ) {
    return this.svc.update(user.tenantId, user.sub, id, input);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('olts.admin')
  async remove(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.svc.remove(user.tenantId, user.sub, id);
  }
}

// =============================================================================
// /v1/provisioning — orquestrador
// =============================================================================
@ApiTags('provisioning')
@ApiBearerAuth()
@RequiresModule('netx-cpe')
@Controller('provisioning')
export class ProvisioningController {
  constructor(private readonly svc: ProvisioningService) {}

  /** Lista contratos aguardando instalação (técnico vê no celular). */
  @Get('pending')
  @RequirePermissions('provisioning.read')
  listPending(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Query(new ZodValidationPipe(ListPendingInstallsQuerySchema)) q: ListPendingInstallsQuery,
  ) {
    return this.svc.listPending(user.tenantId, q);
  }

  /** Ativa cliente em campo (orquestra OLT + RADIUS + TR-069). */
  @Post('install/:contractId')
  @HttpCode(200)
  @RequirePermissions('provisioning.write')
  installCustomer(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('contractId', new ParseUUIDPipe()) contractId: string,
    @ZodBody(InstallCustomerRequestSchema) input: InstallCustomerRequest,
  ) {
    return this.svc.installCustomer(user.tenantId, user.sub, contractId, input);
  }

  /**
   * Troca administrativa da ONT de um contrato (sem abrir O.S de campo).
   * Devolve a ONT antiga ao estoque, provisiona a nova e — crucial —
   * re-cadastra device + Wi-Fi no TR-069 (mesma rotina da O.S SUPPORT_SWAP).
   */
  @Post('contracts/:contractId/swap-ont')
  @HttpCode(200)
  @RequirePermissions('provisioning.write')
  swapOnt(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('contractId', new ParseUUIDPipe()) contractId: string,
    @ZodBody(OntSwapSchema) input: OntSwap,
  ) {
    return this.svc.swapOnt(user.tenantId, user.sub, contractId, input);
  }

  /**
   * Re-tenta o provisionamento da MESMA ONT (re-sync RADIUS + re-enfileira Wi-Fi
   * via TR-069), sem trocar equipamento. Usado na confirmação da O.S quando o
   * cliente ainda não subiu mas a ONT é a certa.
   */
  @Post('contracts/:contractId/reprovision')
  @HttpCode(200)
  @RequirePermissions('provisioning.write')
  reprovision(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('contractId', new ParseUUIDPipe()) contractId: string,
  ) {
    return this.svc.reprovisionContract(user.tenantId, user.sub, contractId);
  }

  /**
   * Desfaz uma instalação feita errada — volta o contrato pra PENDING_INSTALL
   * (sem cancelar). Devolve o comodato, desautoriza na OLT/Ufinet, apaga a ONT
   * e o device TR-069 e limpa o RADIUS.
   */
  @Post('contracts/:contractId/deactivate')
  @HttpCode(200)
  @RequirePermissions('provisioning.write')
  deactivateInstall(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('contractId', new ParseUUIDPipe()) contractId: string,
    @ZodBody(DeactivateInstallSchema) input: { returnLocationId: string },
  ) {
    return this.svc.deactivateInstall(user.tenantId, user.sub, contractId, input);
  }

  /** Poll do status da ONT pós-install. */
  @Get('onts/:id/status')
  @RequirePermissions('provisioning.read')
  ontStatus(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.svc.getOntStatus(user.tenantId, id);
  }
}

// =============================================================================
// /v1/tr069 — admin do ACS (Fase 3 entrega lógica real)
// =============================================================================
@ApiTags('tr069')
@ApiBearerAuth()
@RequiresModule('netx-cpe')
@Controller('tr069')
export class Tr069Controller {
  constructor(
    private readonly svc: Tr069TasksService,
    private readonly diag: Tr069DiagnosticsService,
    private readonly profiles: Tr069ProfilesService,
    private readonly config: Tr069ConfigService,
    private readonly fwCatalog: Tr069FirmwareService,
  ) {}

  // ── Política TR-069 por instância (config + caixa de adoção) ───────────────

  /** Lê a config de políticas TR-069 do tenant. */
  @Get('config')
  @RequirePermissions('tr069.admin')
  getConfig(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.config.get(user.tenantId);
  }

  /** Salva a config de políticas TR-069 do tenant. */
  @Put('config')
  @RequirePermissions('tr069.admin')
  upsertConfig(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodBody(UpsertTr069ConfigRequestSchema) body: UpsertTr069ConfigRequest,
  ) {
    return this.config.upsert(user.tenantId, user.sub, body);
  }

  /** Caixa de adoção — CPEs desconhecidos que informaram (tenantless). */
  @Get('pending')
  @RequirePermissions('tr069.admin')
  listPending() {
    return this.config.listPending();
  }

  /** Adota um pendente: cria o device no tenant (opc. vincula ONT). */
  @Post('pending/:id/adopt')
  @RequirePermissions('tr069.admin')
  adoptPending(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(AdoptPendingDeviceRequestSchema) body: AdoptPendingDeviceRequest,
  ) {
    return this.config.adopt(user.tenantId, user.sub, id, body);
  }

  /** Dispara a campanha de firmware (DOWNLOAD na frota) usando a config. */
  @Post('firmware/campaign')
  @RequirePermissions('tr069.admin')
  firmwareCampaign(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodBody(Tr069FirmwareCampaignRequestSchema) body: Tr069FirmwareCampaignRequest,
  ) {
    return this.config.runFirmwareCampaign(user.tenantId, user.sub, body);
  }

  // ── Catálogo de firmware (upload por modelo + rollout) ─────────────────────

  /** Lista o catálogo de firmware do tenant (com contagens do parque). */
  @Get('firmwares')
  @RequirePermissions('tr069.admin')
  listFirmwares(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.fwCatalog.list(user.tenantId);
  }

  /** Upload de imagem (multipart: file + vendor/productClass/version/notes). */
  @Post('firmwares')
  @RequirePermissions('tr069.admin')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 256 * 1024 * 1024 } }))
  uploadFirmware(
    @CurrentUser() user: AuthenticatedPrincipal,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: unknown,
  ) {
    const fields = UploadTr069FirmwareFieldsSchema.parse(body);
    return this.fwCatalog.upload(user.tenantId, user.sub, file, fields);
  }

  /** Remove imagem do catálogo (arquivo + registro). */
  @Delete('firmwares/:id')
  @RequirePermissions('tr069.admin')
  deleteFirmware(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.fwCatalog.remove(user.tenantId, user.sub, id);
  }

  /** Dispara o rollout (parque do modelo ou seriais escolhidos). */
  @Post('firmwares/:id/deploy')
  @HttpCode(200)
  @RequirePermissions('tr069.admin')
  deployFirmware(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(DeployTr069FirmwareRequestSchema) body: DeployTr069FirmwareRequest,
  ) {
    return this.fwCatalog.deploy(user.tenantId, user.sub, id, body);
  }

  /** Status do rollout (tasks por device + convergência de versão). */
  @Get('firmwares/:id/status')
  @RequirePermissions('tr069.admin')
  firmwareStatus(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.fwCatalog.deployStatus(user.tenantId, id);
  }

  /** Dashboard "Fila de diagnóstico" — KPIs + fila + sintomas. */
  @Get('dashboard')
  @RequirePermissions('tr069.admin')
  dashboard(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.diag.getDashboard(user.tenantId);
  }

  @Get('devices')
  @RequirePermissions('tr069.admin')
  listDevices(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.svc.listDevices(user.tenantId);
  }

  /** Detalhe do device: status + último diagnóstico + alertas abertos + tasks. */
  @Get('devices/:id')
  @RequirePermissions('tr069.admin')
  deviceDetail(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.diag.getDeviceDetail(user.tenantId, id);
  }

  /**
   * Diagnóstico do CPE de um contrato (Hub do Atendente — painel no contrato).
   * Leitura liberada pra operador (provisioning.read); retorna null se o
   * contrato não tem CPE gerenciada.
   */
  @Get('by-contract/:contractId')
  @RequirePermissions('provisioning.read')
  byContract(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('contractId', new ParseUUIDPipe()) contractId: string,
  ) {
    return this.diag.getDeviceByContract(user.tenantId, contractId);
  }

  @Get('devices/:id/tasks')
  @RequirePermissions('tr069.admin')
  tasksForDevice(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.svc.listForDevice(user.tenantId, id);
  }

  /** Série temporal de diagnóstico (gráfico de RX, histórico Wi-Fi). */
  @Get('devices/:id/diagnostics')
  @RequirePermissions('tr069.admin')
  diagnostics(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query(new ZodValidationPipe(ListTr069DiagnosticsQuerySchema)) q: ListTr069DiagnosticsQuery,
  ) {
    return this.diag.listDiagnostics(user.tenantId, id, q.limit);
  }

  /** Enfileira uma coleta de diagnóstico imediata (aplicada no próximo Inform). */
  @Post('devices/:id/refresh')
  @HttpCode(200)
  @RequirePermissions('tr069.admin')
  refresh(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.diag.requestRefresh(user.tenantId, id);
  }

  /** Enfileira um REBOOT do CPE. */
  @Post('devices/:id/reboot')
  @HttpCode(200)
  @RequirePermissions('tr069.admin')
  reboot(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.svc.enqueueReboot(user.tenantId, id, null);
  }

  /** Enfileira um Download de firmware (CPE baixa e aplica). */
  @Post('devices/:id/firmware')
  @HttpCode(200)
  @RequirePermissions('tr069.admin')
  firmware(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(FirmwareUpgradeRequestSchema) input: FirmwareUpgradeRequest,
  ) {
    return this.svc.enqueueFirmwareUpgrade(user.tenantId, id, input);
  }

  /** Dispara um speed test (TR-143 DownloadDiagnostics). */
  @Post('devices/:id/speedtest')
  @HttpCode(200)
  @RequirePermissions('tr069.admin')
  speedTest(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(SpeedTestRequestSchema) input: SpeedTestRequest,
  ) {
    return this.diag.requestSpeedTest(user.tenantId, id, user.sub, input.url);
  }

  /** Dispara um ping (TR-143 IPPingDiagnostics) pra um host. */
  @Post('devices/:id/ping')
  @HttpCode(200)
  @RequirePermissions('tr069.admin')
  ping(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(PingRequestSchema) input: PingRequest,
  ) {
    return this.diag.requestPing(user.tenantId, id, user.sub, input.host);
  }

  /** Histórico de runs TR-143 (speed test / ping) do device. */
  @Get('devices/:id/diag-runs')
  @RequirePermissions('tr069.admin')
  diagRuns(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.diag.listDiagRuns(user.tenantId, id);
  }

  /** Lista plana de todos os atributos TR-069 do último snapshot (visor). */
  @Get('devices/:id/parameters')
  @RequirePermissions('tr069.admin')
  parameters(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.diag.listDeviceParameters(user.tenantId, id);
  }

  /**
   * Edita tuning de rádio Wi-Fi (canal/potência/criptografia) — SET direto no
   * CPE. SSID/senha continuam vindo do contrato; o reconciliador ignora estes.
   */
  @Post('devices/:id/wifi')
  @HttpCode(200)
  @RequirePermissions('tr069.admin')
  setWifi(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(SetWifiRadioSchema) input: SetWifiRadio,
  ) {
    return this.diag.setWifiRadio(user.tenantId, id, user.sub, input);
  }

  /**
   * Edita toggles de roteador (fuso/NTP + band steering) — SET direto no CPE.
   * UPnP/EasyMesh não são expostos via TR-069 nesse firmware.
   */
  @Post('devices/:id/router')
  @HttpCode(200)
  @RequirePermissions('tr069.admin')
  setRouter(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(SetRouterSettingsSchema) input: SetRouterSettings,
  ) {
    return this.diag.setRouterSettings(user.tenantId, id, user.sub, input);
  }

  /** Dispara o scan de vizinhança Wi-Fi (heatmap de canais 2.4G). */
  @Post('devices/:id/wifi-scan')
  @HttpCode(200)
  @RequirePermissions('tr069.admin')
  requestWifiScan(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.diag.requestWifiScan(user.tenantId, id, user.sub);
  }

  /** Resultado do scan de vizinhança (redes + ocupação por canal 2.4G). */
  @Get('devices/:id/wifi-scan')
  @RequirePermissions('tr069.admin')
  getWifiScan(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.diag.getWifiScan(user.tenantId, id);
  }

  /**
   * Probe de data model — enfileira um GET com caminhos arbitrários (ferramenta
   * de bancada pra descobrir os paths Huawei reais antes de codar SET).
   */
  @Post('devices/:id/probe')
  @HttpCode(200)
  @RequirePermissions('tr069.admin')
  probe(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(Tr069ProbeRequestSchema) input: Tr069ProbeRequest,
  ) {
    return this.diag.enqueueProbe(user.tenantId, id, user.sub, input.names);
  }

  /** Resultado de um probe (status + params do GET). */
  @Get('devices/:id/probe/:taskId')
  @RequirePermissions('tr069.admin')
  probeResult(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('taskId', new ParseUUIDPipe()) taskId: string,
  ) {
    return this.diag.getProbeResult(user.tenantId, id, taskId);
  }

  /** Histórico do device: reboots/quedas (14d), disponibilidade (30d), timeline. */
  @Get('devices/:id/history')
  @RequirePermissions('tr069.admin')
  deviceHistory(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.diag.getDeviceHistory(user.tenantId, id);
  }

  // ── Notas do device (atendimento N1) ───────────────────────────────────────

  /** Lista as notas livres do device. */
  @Get('devices/:id/notes')
  @RequirePermissions('tr069.admin')
  listNotes(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.diag.listNotes(user.tenantId, id);
  }

  /** Cria uma nota livre no device. */
  @Post('devices/:id/notes')
  @HttpCode(201)
  @RequirePermissions('tr069.admin')
  createNote(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(CreateTr069DeviceNoteSchema) input: CreateTr069DeviceNote,
  ) {
    return this.diag.createNote(user.tenantId, id, user, input.body);
  }

  /** Remove (soft-delete) uma nota do device. */
  @Delete('devices/:id/notes/:noteId')
  @HttpCode(204)
  @RequirePermissions('tr069.admin')
  async deleteNote(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('noteId', new ParseUUIDPipe()) noteId: string,
  ): Promise<void> {
    await this.diag.deleteNote(user.tenantId, id, noteId, user.sub);
  }

  /** Ranking de cobertura Wi-Fi (piores RSSI médios) — proativo / venda de mesh. */
  @Get('wifi-coverage')
  @RequirePermissions('provisioning.read')
  wifiCoverage(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Query(new ZodValidationPipe(ListWifiCoverageQuerySchema)) q: ListWifiCoverageQuery,
  ) {
    return this.diag.getWifiCoverage(user.tenantId, q);
  }

  /** Lista de alertas de diagnóstico (dashboard / triagem). */
  @Get('alerts')
  @RequirePermissions('tr069.admin')
  alerts(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Query(new ZodValidationPipe(ListTr069AlertsQuerySchema)) q: ListTr069AlertsQuery,
  ) {
    return this.diag.listAlerts(user.tenantId, q);
  }

  @Delete('tasks/:id')
  @HttpCode(204)
  @RequirePermissions('tr069.admin')
  async cancelTask(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.svc.cancelTask(user.tenantId, id);
  }

  // ── Conformidade / profiles (Fase 4) ───────────────────────────────────────

  /** Conformidade de um device: status + profile casado + drifts. */
  @Get('devices/:id/compliance')
  @RequirePermissions('tr069.admin')
  deviceCompliance(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.profiles.deviceCompliance(user.tenantId, id);
  }

  /** Reconcilia um device agora (resolve drift + enfileira SET conforme profile). */
  @Post('devices/:id/reconcile')
  @HttpCode(200)
  @RequirePermissions('tr069.admin')
  reconcileNow(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.profiles.reconcileNow(user.tenantId, id);
  }

  /** Lista profiles (modelos homologados) do tenant. */
  @Get('profiles')
  @RequirePermissions('tr069.admin')
  listProfiles(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.profiles.list(user.tenantId);
  }

  @Get('profiles/:id')
  @RequirePermissions('tr069.admin')
  getProfile(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.profiles.get(user.tenantId, id);
  }

  @Post('profiles')
  @RequirePermissions('tr069.admin')
  createProfile(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodBody(CreateTr069ProfileSchema) input: CreateTr069Profile,
  ) {
    return this.profiles.create(user.tenantId, user.sub, input);
  }

  @Patch('profiles/:id')
  @RequirePermissions('tr069.admin')
  updateProfile(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(UpdateTr069ProfileSchema) input: UpdateTr069Profile,
  ) {
    return this.profiles.update(user.tenantId, id, input);
  }

  @Delete('profiles/:id')
  @HttpCode(204)
  @RequirePermissions('tr069.admin')
  async deleteProfile(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.profiles.remove(user.tenantId, id);
  }
}
