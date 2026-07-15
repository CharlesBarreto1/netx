import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CopilotService } from './copilot.service.js';
import { AnomalyService } from './anomaly.service.js';
import { LlmService } from './llm.service.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { CopilotSchema, type CopilotDto } from './copilot.dto.js';
import { CurrentUser, Roles } from '../auth/auth.decorators.js';
import type { AuthUser } from '../auth/auth.types.js';

@Controller()
export class AiController {
  constructor(
    private readonly copilot: CopilotService,
    private readonly anomaly: AnomalyService,
    private readonly llm: LlmService,
  ) {}

  /** Status da IA — delega ao motor do NetX (por-tenant), com o token do operador. */
  @Get('ai/status')
  async status(@Headers('authorization') authz?: string) {
    return { available: await this.llm.available(authz) };
  }

  /** Copiloto de diagnóstico (grounded nas evidências do device). Read-only: qualquer autenticado. */
  @Post('devices/:id/copilot')
  ask(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(CopilotSchema)) dto: CopilotDto,
    @CurrentUser() user: AuthUser,
    @Headers('authorization') authz?: string,
  ) {
    return this.copilot.ask(id, dto.question, user.username, authz);
  }

  /** Dispara a varredura de anomalias estatísticas para o device. */
  @Roles('admin', 'operator')
  @Post('devices/:id/anomaly-scan')
  scan(@Param('id', ParseUUIDPipe) id: string) {
    return this.anomaly.scanDevice(id);
  }
}
