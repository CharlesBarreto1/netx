import { ConfigService } from '@nestjs/config';
import { Queue, QueueEvents, type ConnectionOptions } from 'bullmq';
import { QUEUE_DEVICE_JOBS } from '@netx-nms/shared';
import type { Env } from '../config/env.js';

/** Converte a REDIS_URL em opções de conexão do ioredis embutido no BullMQ. */
export function redisConnectionFromUrl(url: string): ConnectionOptions {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 6379,
    ...(u.username ? { username: decodeURIComponent(u.username) } : {}),
    ...(u.password ? { password: decodeURIComponent(u.password) } : {}),
    maxRetriesPerRequest: null,
  };
}

/** Cria a fila BullMQ apontando pro Redis configurado. */
export function createDeviceJobsQueue(config: ConfigService<Env, true>): Queue {
  const url = config.get('REDIS_URL', { infer: true });
  return new Queue(QUEUE_DEVICE_JOBS, { connection: redisConnectionFromUrl(url) });
}

/** Eventos da fila — necessários para aguardar o resultado de um job (waitUntilFinished). */
export function createDeviceJobsEvents(config: ConfigService<Env, true>): QueueEvents {
  const url = config.get('REDIS_URL', { infer: true });
  return new QueueEvents(QUEUE_DEVICE_JOBS, { connection: redisConnectionFromUrl(url) });
}
