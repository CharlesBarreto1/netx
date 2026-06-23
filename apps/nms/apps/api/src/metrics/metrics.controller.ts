import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { MetricsService } from './metrics.service.js';
import { EventsService } from './events.service.js';

@Controller('devices/:id')
export class MetricsController {
  constructor(
    private readonly metrics: MetricsService,
    private readonly events: EventsService,
  ) {}

  @Get('metrics/interfaces')
  interfaces(@Param('id', ParseUUIDPipe) id: string) {
    return this.metrics.interfaceRates(id);
  }

  @Get('metrics/optical')
  optical(@Param('id', ParseUUIDPipe) id: string) {
    return this.metrics.optical(id);
  }

  @Get('metrics/system')
  system(@Param('id', ParseUUIDPipe) id: string) {
    return this.metrics.system(id);
  }

  @Get('events')
  eventsList(@Param('id', ParseUUIDPipe) id: string) {
    return this.events.listForDevice(id);
  }
}
