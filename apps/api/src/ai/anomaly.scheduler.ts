import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { AnomalyService } from './anomaly.service.js';
import type { Env } from '../config/env.js';

/** Varredura periódica de anomalias estatísticas (ANOMALY_CRON). */
@Injectable()
export class AnomalyScheduler implements OnModuleInit {
  private readonly logger = new Logger(AnomalyScheduler.name);

  constructor(
    private readonly anomaly: AnomalyService,
    private readonly registry: SchedulerRegistry,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onModuleInit(): void {
    const cron = this.config.get('ANOMALY_CRON', { infer: true });
    const job = new CronJob(cron, () => void this.anomaly.scanAll());
    this.registry.addCronJob(
      'anomaly-scan',
      job as unknown as Parameters<SchedulerRegistry['addCronJob']>[1],
    );
    job.start();
    this.logger.log(`varredura de anomalias agendada: ${cron}`);
  }
}
