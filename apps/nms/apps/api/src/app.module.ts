import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { validateEnv } from './config/env.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { AuthModule } from './auth/auth.module.js';
import { QueueModule } from './queue/queue.module.js';
import { HealthModule } from './health/health.module.js';
import { AuditModule } from './audit/audit.module.js';
import { DevicesModule } from './devices/devices.module.js';
import { MetricsModule } from './metrics/metrics.module.js';
import { PlaybooksModule } from './playbooks/playbooks.module.js';
import { BackupModule } from './backup/backup.module.js';
import { ConfigApplyModule } from './config-apply/config-apply.module.js';
import { DiagnosticsModule } from './diagnostics/diagnostics.module.js';
import { LlmModule } from './ai/llm.module.js';
import { AiModule } from './ai/ai.module.js';
import { EventsModule } from './events/events.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    ScheduleModule.forRoot(),
    LlmModule,
    PrismaModule,
    AuthModule,
    AuditModule,
    QueueModule,
    HealthModule,
    DevicesModule,
    MetricsModule,
    PlaybooksModule,
    BackupModule,
    ConfigApplyModule,
    DiagnosticsModule,
    AiModule,
    EventsModule,
  ],
})
export class AppModule {}
