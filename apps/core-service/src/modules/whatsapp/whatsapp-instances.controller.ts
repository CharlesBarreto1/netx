import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import type { AuthenticatedPrincipal } from '@netx/shared';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { ZodBody } from '../../common/zod.pipe';
import { RequiresModule } from '../licensing/license.decorators';

import { WhatsappInstancesService } from './whatsapp-instances.service';

// Schema inline — endpoint admin-only. Campos variam por canal; validação
// cruzada no .superRefine (WAHA exige apiKey; Meta exige creds do número).
const CreateInstanceBodySchema = z
  .object({
    name: z.string().min(1).max(120),
    channel: z.enum(['WAHA', 'META_CLOUD']).default('WAHA'),
    // Nome interno: alfanumérico + . _ - (safe pra URL path / sessão WAHA).
    instanceName: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9._-]+$/u, 'instanceName aceita apenas letras, dígitos, ".", "_", "-"'),
    // --- WAHA ---
    evolutionUrl: z.string().url().max(255).optional(), // base URL do WAHA
    apiKey: z.string().min(8).max(255).optional(), // X-Api-Key do WAHA
    // --- Meta Cloud ---
    wabaId: z.string().max(40).optional(),
    phoneNumberId: z.string().max(40).optional(),
    accessToken: z.string().max(1024).optional(),
    appSecret: z.string().max(255).optional(),
    verifyToken: z.string().max(120).optional(),
  })
  .superRefine((v, ctx) => {
    // WAHA: URL e X-Api-Key vêm do env do servidor (provisionado pelo installer)
    // — nada obrigatório no request. Meta exige as credenciais do número.
    if (v.channel === 'META_CLOUD') {
      for (const f of ['phoneNumberId', 'accessToken', 'appSecret'] as const) {
        if (!v[f]) ctx.addIssue({ code: 'custom', path: [f], message: `${f} é obrigatório no canal Meta` });
      }
    }
  });
type CreateInstanceBody = z.infer<typeof CreateInstanceBodySchema>;

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
@RequiresModule('netx-call')
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
    @ZodBody(CreateInstanceBodySchema) body: CreateInstanceBody,
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
