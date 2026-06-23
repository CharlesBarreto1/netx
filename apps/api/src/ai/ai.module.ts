import { Module } from '@nestjs/common';
import { AiController } from './ai.controller.js';
import { CopilotService } from './copilot.service.js';
import { AnomalyService } from './anomaly.service.js';
import { AnomalyScheduler } from './anomaly.scheduler.js';
import { DevicesModule } from '../devices/devices.module.js';
import { MetricsModule } from '../metrics/metrics.module.js';
import { BackupModule } from '../backup/backup.module.js';

@Module({
  imports: [DevicesModule, MetricsModule, BackupModule],
  controllers: [AiController],
  providers: [CopilotService, AnomalyService, AnomalyScheduler],
})
export class AiModule {}
