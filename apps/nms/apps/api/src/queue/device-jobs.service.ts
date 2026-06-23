import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Queue, QueueEvents } from 'bullmq';
import {
  assertJobIsSafe,
  DeviceJobResultSchema,
  type DeviceJobInput,
  type DeviceJobResult,
} from '@netx-nms/shared';
import { DEVICE_JOBS_EVENTS, DEVICE_JOBS_QUEUE } from './queue.tokens.js';

/** Quanto a API espera o gateway responder antes de desistir. */
const DEFAULT_WAIT_MS = 20_000;

export interface EnqueueOptions {
  /** Remove o job do Redis ao concluir. Use para jobs que carregam segredo em claro. */
  removeOnComplete?: boolean;
  waitMs?: number;
}

@Injectable()
export class DeviceJobsService implements OnModuleDestroy {
  private readonly logger = new Logger(DeviceJobsService.name);

  constructor(
    @Inject(DEVICE_JOBS_QUEUE) private readonly queue: Queue,
    @Inject(DEVICE_JOBS_EVENTS) private readonly events: QueueEvents,
  ) {}

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([this.queue.close(), this.events.close()]);
  }

  /** Enfileira sem aguardar resultado (fire-and-forget). Valida o contrato e a trava de escrita. */
  async enqueue(job: DeviceJobInput): Promise<void> {
    const safe = assertJobIsSafe(job);
    await this.queue.add(safe.kind, safe, { jobId: safe.jobId, removeOnComplete: 1000 });
    this.logger.log(`job enfileirado: ${safe.kind} para device ${safe.deviceId}`);
  }

  /** Enfileira e aguarda o resultado estruturado devolvido pelo device-gateway. */
  async enqueueAndWait(job: DeviceJobInput, opts: EnqueueOptions = {}): Promise<DeviceJobResult> {
    const safe = assertJobIsSafe(job);
    const added = await this.queue.add(safe.kind, safe, {
      jobId: safe.jobId,
      removeOnComplete: opts.removeOnComplete ?? 1000,
      removeOnFail: opts.removeOnComplete ?? 1000,
    });
    this.logger.log(`job enfileirado (aguardando): ${safe.kind} para device ${safe.deviceId}`);
    const raw = await added.waitUntilFinished(this.events, opts.waitMs ?? DEFAULT_WAIT_MS);
    return DeviceJobResultSchema.parse(raw);
  }
}
