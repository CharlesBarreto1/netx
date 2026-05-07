import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import type { AuthenticatedPrincipal } from '@netx/shared';
import { CurrentUser, RequirePermissions } from '../../common/decorators';

import { WhatsappInstancesService } from './whatsapp-instances.service';

interface CreateInstanceBody {
  name: string;
  evolutionUrl?: string;
  apiKey: string;
  instanceName: string;
}

/**
 * CRUD de instâncias WhatsApp (sessões Evolution).
 *
 * Permissão: `chat.admin` em todos os endpoints — só admin gerencia conexão.
 *
 * Rotas (admin):
 *   GET    /v1/whatsapp/instances                    — lista (sem expor apiKey)
 *   POST   /v1/whatsapp/instances                    — cria + chama Evolution createInstance
 *   GET    /v1/whatsapp/instances/:id                — detalhe (inclui QR se aguardando)
 *   POST   /v1/whatsapp/instances/:id/connect        — força reconexão (refresh QR)
 *   POST   /v1/whatsapp/instances/:id/logout         — desconecta sessão (mantém instância)
 *   DELETE /v1/whatsapp/instances/:id                — remove instância (Evolution + local)
 */
@ApiTags('whatsapp-instances')
@ApiBearerAuth()
@Controller('whatsapp/instances')
export class WhatsappInstancesController {
  constructor(private readonly instances: WhatsappInstancesService) {}

  @Get()
  @RequirePermissions('chat.admin')
  list(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.instances.list(user.tenantId);
  }

  @Get(':id')
  @RequirePermissions('chat.admin')
  findOne(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.instances.findById(user.tenantId, id);
  }

  @Post()
  @RequirePermissions('chat.admin')
  create(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Body() body: CreateInstanceBody,
  ) {
    return this.instances.create(user.tenantId, user.sub, body);
  }

  @Post(':id/connect')
  @RequirePermissions('chat.admin')
  connect(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.instances.refreshQr(user.tenantId, user.sub, id);
  }

  @Post(':id/logout')
  @RequirePermissions('chat.admin')
  logout(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.instances.logout(user.tenantId, user.sub, id);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('chat.admin')
  async remove(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.instances.remove(user.tenantId, user.sub, id);
  }
}
