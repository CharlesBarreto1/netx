import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { DevicesService } from './devices.service.js';
import { CredentialsService } from './credentials.service.js';
import { ConnectivityService } from './connectivity.service.js';
import { SnmpConfigService } from './snmp-config.service.js';
import { DiscoveryService } from './discovery.service.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { CurrentUser, Roles } from '../auth/auth.decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import {
  CreateDeviceSchema,
  UpdateDeviceSchema,
  UpsertFromCoreSchema,
  type CreateDeviceDto,
  type UpdateDeviceDto,
  type UpsertFromCoreDto,
} from './device.dto.js';
import { SetCredentialSchema, type SetCredentialDto } from './credential.dto.js';

@Controller('devices')
export class DevicesController {
  constructor(
    private readonly devices: DevicesService,
    private readonly credentials: CredentialsService,
    private readonly connectivity: ConnectivityService,
    private readonly snmpConfig: SnmpConfigService,
    private readonly discovery: DiscoveryService,
  ) {}

  @Get()
  findAll() {
    return this.devices.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.devices.findOne(id);
  }

  @Get(':id/interfaces')
  listInterfaces(@Param('id', ParseUUIDPipe) id: string) {
    return this.devices.listInterfaces(id);
  }

  @Roles('admin')
  @Post()
  create(
    @Body(new ZodValidationPipe(CreateDeviceSchema)) dto: CreateDeviceDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.devices.create(dto, user.username);
  }

  /**
   * Sync vindo do NetX Core (Planta de rede → NMS). Idempotente por
   * coreEquipmentId. Chamado pelo NmsSyncService do Core com um token de
   * serviço; `admin` porque cria/edita device.
   *
   * Fica ANTES de `:id` de propósito — o Nest casa rotas na ordem de
   * declaração, e `from-core` seria capturado por `@Put(':id')`.
   */
  @Roles('admin')
  @Put('from-core')
  upsertFromCore(
    @Body(new ZodValidationPipe(UpsertFromCoreSchema)) dto: UpsertFromCoreDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.devices.upsertFromCore(dto, user.username);
  }

  /** Desvincula (não apaga) o device quando o equipamento sai do Core. */
  @Roles('admin')
  @Delete('from-core/:coreEquipmentId')
  @HttpCode(204)
  async detachFromCore(
    @Param('coreEquipmentId', ParseUUIDPipe) coreEquipmentId: string,
    @CurrentUser() user: AuthUser,
  ) {
    await this.devices.detachFromCore(coreEquipmentId, user.username);
  }

  @Roles('admin')
  @Put(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateDeviceSchema)) dto: UpdateDeviceDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.devices.update(id, dto, user.username);
  }

  @Roles('admin')
  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    await this.devices.remove(id, user.username);
  }

  /** Grava credenciais cifradas via cofre. Devolve só o status (nunca segredo). */
  @Roles('admin')
  @Post(':id/credentials')
  setCredentials(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(SetCredentialSchema)) dto: SetCredentialDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.credentials.set(id, dto, user.username);
  }

  /** Testa SSH + NETCONF(830) + SNMP no equipamento (via gateway). */
  @Roles('admin', 'operator')
  @Post(':id/connectivity-test')
  testConnectivity(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.connectivity.test(id, user.username);
  }

  /** (Re)materializa a config SNMP do Telegraf para este device. */
  @Roles('admin', 'operator')
  @Post(':id/snmp-config/sync')
  syncSnmpConfig(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.snmpConfig.syncDevice(id, user.username);
  }

  /** Descobre as interfaces via SNMP e popula a tabela Interface. */
  @Roles('admin', 'operator')
  @Post(':id/discover-interfaces')
  discoverInterfaces(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.discovery.discover(id, user.username);
  }
}
