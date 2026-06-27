/**
 * Copiloto agêntico — POST /v1/ai/ask. Read-only (perm ai.ask). Mesma rota do
 * F3 anterior; agora servida pelo copiloto tool-using.
 */
import { Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { AiAskRequestSchema, type AiAskRequest, type AuthenticatedPrincipal } from '@netx/shared';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { ZodBody } from '../../common/zod.pipe';

import { CopilotService } from './copilot.service';

@ApiTags('ai')
@ApiBearerAuth()
@Controller('ai')
export class CopilotController {
  constructor(private readonly copilot: CopilotService) {}

  @Post('ask')
  @RequirePermissions('ai.ask')
  ask(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodBody(AiAskRequestSchema) body: AiAskRequest,
  ) {
    return this.copilot.ask(user.tenantId, body.question);
  }
}
