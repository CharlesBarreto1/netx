/**
 * CopilotModule — copiloto agêntico (tool-using). Importa o AiModule (motor) e
 * o RadiusModule (sessão PPPoE). Demais dados vêm via PrismaService (@Global).
 *
 * Exporta o CopilotService pra o WhatsappModule reusar o mesmo cérebro no canal
 * WhatsApp (Nexus). Sem ciclo: o copiloto não importa o WhatsApp de volta.
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
  exports: [CopilotService],
})
export class CopilotModule {}
