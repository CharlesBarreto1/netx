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

/** Quanto tempo (s) o job fica no Redis após concluir, para polling assíncrono. */
const POLL_RETENTION_S = 1800;

export type JobStatus =
  | { state: 'not_found' }
  | { state: 'waiting' | 'active' | 'delayed' }
  | { state: 'completed'; result: DeviceJobResult }
  | { state: 'failed'; error: string };

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

  /**
   * Enfileira SEM aguardar e devolve o jobId. O job fica no Redis por
   * POLL_RETENTION_S para ser consultado depois (getStatus) — padrão do
   * diagnóstico ativo do copiloto, que não bloqueia a request HTTP.
   */
  async enqueueAsync(job: DeviceJobInput): Promise<string> {
    const safe = assertJobIsSafe(job);
    await this.queue.add(safe.kind, safe, {
      jobId: safe.jobId,
      removeOnComplete: { age: POLL_RETENTION_S },
      removeOnFail: { age: POLL_RETENTION_S },
    });
    this.logger.log(`job enfileirado (async): ${safe.kind} job=${safe.jobId}`);
    return safe.jobId;
  }

  /** Consulta o estado/resultado de um job por id (para polling). */
  async getStatus(jobId: string): Promise<JobStatus> {
    const job = await this.queue.getJob(jobId);
    if (!job) return { state: 'not_found' };
    const state = await job.getState();
    if (state === 'completed') {
      return { state: 'completed', result: DeviceJobResultSchema.parse(job.returnvalue) };
    }
    if (state === 'failed') {
      return { state: 'failed', error: job.failedReason ?? 'job falhou' };
    }
    // waiting | active | delayed | (paused → tratamos como waiting)
    return { state: state === 'active' ? 'active' : state === 'delayed' ? 'delayed' : 'waiting' };
  }
}
