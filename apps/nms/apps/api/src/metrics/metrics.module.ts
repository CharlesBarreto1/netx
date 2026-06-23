import { Module } from '@nestjs/common';
import { MetricsController } from './metrics.controller.js';
import { MetricsService } from './metrics.service.js';
import { EventsService } from './events.service.js';
import { DevicesModule } from '../devices/devices.module.js';

@Module({
  imports: [DevicesModule],
  controllers: [MetricsController],
  providers: [MetricsService, EventsService],
  exports: [MetricsService, EventsService],
})
export class MetricsModule {}
