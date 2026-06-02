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
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  CreateOltRequestSchema,
  InstallCustomerRequestSchema,
  ListOltsQuerySchema,
  ListPendingInstallsQuerySchema,
  ListTr069AlertsQuerySchema,
  ListTr069DiagnosticsQuerySchema,
  UpdateOltRequestSchema,
  type AuthenticatedPrincipal,
  type CreateOltRequest,
  type InstallCustomerRequest,
  type ListOltsQuery,
  type ListPendingInstallsQuery,
  type ListTr069AlertsQuery,
  type ListTr069DiagnosticsQuery,
  type UpdateOltRequest,
} from '@netx/shared';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { ZodBody, ZodValidationPipe } from '../../common/zod.pipe';

import { OltsService } from './olts.service';
import { ProvisioningService } from './provisioning.service';
import { Tr069DiagnosticsService } from './tr069-diagnostics.service';
import { Tr069TasksService } from './tr069-tasks.service';

// =============================================================================
// /v1/olts — CRUD admin
// =============================================================================
@ApiTags('olts')
@ApiBearerAuth()
@Controller('olts')
export class OltsController {
  constructor(private readonly svc: OltsService) {}

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
}

// =============================================================================
// /v1/provisioning — orquestrador
// =============================================================================
@ApiTags('provisioning')
@ApiBearerAuth()
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
@Controller('tr069')
export class Tr069Controller {
  constructor(
    private readonly svc: Tr069TasksService,
    private readonly diag: Tr069DiagnosticsService,
  ) {}

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
}
