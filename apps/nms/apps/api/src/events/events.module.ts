import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { EventConsumerService } from './event-consumer.service.js';

/**
 * Canal 3 do ecossistema: consumidor do bus `netx.events`. OFF por default
 * (ver EventConsumerService). Ver docs/ecosystem/INTEGRATION-RUNBOOK.md §A.3.
 */
@Module({
  imports: [ConfigModule],
  providers: [EventConsumerService],
})
export class EventsModule {}
