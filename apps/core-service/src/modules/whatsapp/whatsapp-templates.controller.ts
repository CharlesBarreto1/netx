import { Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import type { AuthenticatedPrincipal } from '@netx/shared';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { RequiresModule } from '../licensing/license.decorators';

import { WhatsappTemplatesService } from './whatsapp-templates.service';

/**
 * Templates HSM (canal META_CLOUD).
 *
 * Rotas:
 *   GET  /v1/whatsapp/templates                       — aprovados (picker do operador)
 *   POST /v1/whatsapp/instances/:id/templates/sync    — sincroniza da WABA (admin)
 */
@ApiTags('whatsapp-templates')
@ApiBearerAuth()
@RequiresModule('netx-call')
@Controller('whatsapp')
export class WhatsappTemplatesController {
  constructor(private readonly templates: WhatsappTemplatesService) {}

  @Get('templates')
  @RequirePermissions('chat.send')
  list(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.templates.list(user.tenantId);
  }

  @Post('instances/:id/templates/sync')
  @RequirePermissions('chat.admin')
  sync(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.templates.sync(user.tenantId, user.sub, id);
  }
}
