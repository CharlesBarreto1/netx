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
import { CurrentUser, RequirePermissions } from '../../../common/decorators';
import { ZodBody } from '../../../common/zod.pipe';
import { RequiresModule } from '../../licensing/license.decorators';

import { NexusOperatorsService } from './nexus-operators.service';

const AddOperatorBodySchema = z.object({
  userId: z.string().uuid(),
});
type AddOperatorBody = z.infer<typeof AddOperatorBodySchema>;

/**
 * Operadores da Nexus (linha WhatsApp interna). Admin-only (`chat.admin`).
 *
 * Rotas:
 *   GET    /v1/whatsapp/nexus/operators              — lista operadores + status
 *   POST   /v1/whatsapp/nexus/operators              — adiciona (gera pairCode)
 *   POST   /v1/whatsapp/nexus/operators/:id/regen    — novo código (PENDING)
 *   DELETE /v1/whatsapp/nexus/operators/:id          — remove (libera número/usuário)
 */
@ApiTags('whatsapp-nexus')
@ApiBearerAuth()
@RequiresModule('netx-call')
@Controller('whatsapp/nexus')
export class NexusOperatorsController {
  constructor(private readonly operators: NexusOperatorsService) {}

  @Get('operators')
  @RequirePermissions('chat.admin')
  list(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.operators.list(user.tenantId);
  }

  @Post('operators')
  @RequirePermissions('chat.admin')
  add(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodBody(AddOperatorBodySchema) body: AddOperatorBody,
  ) {
    return this.operators.add(user.tenantId, user.sub, body.userId);
  }

  @Post('operators/:id/regen')
  @RequirePermissions('chat.admin')
  regen(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.operators.regenerateCode(user.tenantId, user.sub, id);
  }

  @Delete('operators/:id')
  @HttpCode(204)
  @RequirePermissions('chat.admin')
  async remove(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.operators.remove(user.tenantId, user.sub, id);
  }
}
