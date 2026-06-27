/**
 * AiModule — motor de IA do NetX (@netx/ai) dentro do core-service.
 *
 * Exporta AiService para que outros módulos (alarmes, copiloto, preditiva)
 * consumam o motor sem reimplementar transporte/fallback/redaction.
 * Prisma e Crypto são @Global; AuditModule é importado.
 */
import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';

import { AiConfigService } from './ai-config.service';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { CopilotService } from './copilot.service';

@Module({
  imports: [AuditModule],
  controllers: [AiController],
  providers: [AiService, AiConfigService, CopilotService],
  exports: [AiService],
})
export class AiModule {}
