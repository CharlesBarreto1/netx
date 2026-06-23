import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DEVICE_JOBS_EVENTS, DEVICE_JOBS_QUEUE } from './queue.tokens.js';
import { DeviceJobsService } from './device-jobs.service.js';
import { createDeviceJobsEvents, createDeviceJobsQueue } from './queue.providers.js';

/**
 * Ponte Node → Python: a API SÓ enfileira. Nenhuma sessão SSH/NETCONF é aberta aqui
 * (AGENTS.md §3). O device-gateway (Python) consome esta fila.
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: DEVICE_JOBS_QUEUE,
      inject: [ConfigService],
      useFactory: createDeviceJobsQueue,
    },
    {
      provide: DEVICE_JOBS_EVENTS,
      inject: [ConfigService],
      useFactory: createDeviceJobsEvents,
    },
    DeviceJobsService,
  ],
  exports: [DeviceJobsService],
})
export class QueueModule {}
