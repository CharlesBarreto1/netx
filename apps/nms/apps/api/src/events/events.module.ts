import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { EventConsumerService } from './event-consumer.service.js';
import { EventPublisherService } from './event-publisher.service.js';

/**
 * Canal 3 do ecossistema: consumidor + publisher do bus `netx.events`. O
 * consumidor é OFF por default; o publisher é no-op sem RABBITMQ_URL. @Global
 * pra qualquer módulo (ex.: DevicesModule) injetar o publisher e emitir eventos.
 * Ver docs/ecosystem/INTEGRATION-RUNBOOK.md §A.3.
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [EventConsumerService, EventPublisherService],
  exports: [EventPublisherService],
})
export class EventsModule {}
