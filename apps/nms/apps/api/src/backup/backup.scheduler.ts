import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { PrismaService } from '../prisma/prisma.service.js';
import { BackupService } from './backup.service.js';
import type { Env } from '../config/env.js';

/** Backup automático de todos os devices com credencial, no cron configurado (BACKUP_CRON). */
@Injectable()
export class BackupScheduler implements OnModuleInit {
  private readonly logger = new Logger(BackupScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly backup: BackupService,
    private readonly registry: SchedulerRegistry,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onModuleInit(): void {
    const cron = this.config.get('BACKUP_CRON', { infer: true });
    const job = new CronJob(cron, () => void this.runAll());
    this.registry.addCronJob(
      'config-backup',
      job as unknown as Parameters<SchedulerRegistry['addCronJob']>[1],
    );
    job.start();
    this.logger.log(`backup automático agendado: ${cron}`);
  }

  /** Roda backup de todo device que tem senha cadastrada. Falha de um não derruba os outros. */
  async runAll(): Promise<void> {
    const creds = await this.prisma.deviceCredential.findMany({
      where: { passwordEnc: { not: null } },
      select: { deviceId: true },
    });
    this.logger.log(`backup automático: ${creds.length} devices`);
    for (const { deviceId } of creds) {
      try {
        await this.backup.backup(deviceId, 'scheduler');
      } catch (err) {
        this.logger.warn(`backup do device ${deviceId} falhou: ${String(err)}`);
      }
    }
  }
}
