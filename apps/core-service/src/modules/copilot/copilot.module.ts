/**
 * CopilotModule — copiloto agêntico (tool-using). Importa o AiModule (motor) e
 * o RadiusModule (sessão PPPoE). Demais dados vêm via PrismaService (@Global).
 *
 * Ninguém importa este módulo de volta → sem ciclo (AlarmsModule↔AiModule já
 * usa AiModule; manter o copiloto fora do AiModule evita o ciclo).
 */
import { Module } from '@nestjs/common';

import { AiModule } from '../ai/ai.module';
import { RadiusModule } from '../radius/radius.module';

import { CopilotController } from './copilot.controller';
import { CopilotService } from './copilot.service';
import { InsightsService } from './insights.service';
import { NmsClient } from './nms-client';

@Module({
  imports: [AiModule, RadiusModule],
  controllers: [CopilotController],
  providers: [CopilotService, NmsClient, InsightsService],
})
export class CopilotModule {}
