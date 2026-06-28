/**
 * Copiloto agêntico — POST /v1/ai/ask. Read-only (perm ai.ask). Mesma rota do
 * F3 anterior; agora servida pelo copiloto tool-using.
 */
import { Controller, Get, Headers, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { AiAskRequestSchema, type AiAskRequest, type AuthenticatedPrincipal } from '@netx/shared';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { ZodBody } from '../../common/zod.pipe';

import { CopilotService } from './copilot.service';

/** Extrai o token cru do header Authorization (encaminhado ao NMS). */
function bearer(authHeader?: string): string | null {
  if (!authHeader) return null;
  const m = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  return m ? m[1] : null;
}

@ApiTags('ai')
@ApiBearerAuth()
@Controller('ai')
export class CopilotController {
  constructor(private readonly copilot: CopilotService) {}

  @Post('ask')
  @RequirePermissions('ai.ask')
  ask(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Headers('authorization') authHeader: string | undefined,
    @ZodBody(AiAskRequestSchema) body: AiAskRequest,
  ) {
    return this.copilot.ask(user.tenantId, body.question, bearer(authHeader));
  }

  /** Polling do resultado de um teste ativo disparado pela IA (render no Nexus). */
  @Get('test/:jobId')
  @RequirePermissions('ai.ask')
  testStatus(
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Headers('authorization') authHeader: string | undefined,
  ) {
    return this.copilot.testStatus(jobId, bearer(authHeader));
  }
}
