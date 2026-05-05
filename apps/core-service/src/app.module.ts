import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { ClsModule } from 'nestjs-cls';
import { LoggerModule } from 'nestjs-pino';

import { AuthModule } from './modules/auth/auth.module';
import { AuditModule } from './modules/audit/audit.module';
import { ContractsModule } from './modules/contracts/contracts.module';
import { CrmModule } from './modules/crm/crm.module';
import { ServiceOrdersModule } from './modules/service-orders/service-orders.module';
import { FinanceModule } from './modules/finance/finance.module';
import { ReportsModule } from './modules/reports/reports.module';
import { BackupsModule } from './modules/backups/backups.module';
import { HealthModule } from './modules/health/health.module';
import { PrismaModule } from './modules/prisma/prisma.module';
import { RadiusModule } from './modules/radius/radius.module';
import { RolesModule } from './modules/roles/roles.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),

    // Pino logger (structured JSON in prod, pretty in dev)
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        base: { service: 'core-service' },
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            '*.password',
            '*.passwordHash',
          ],
          censor: '[REDACTED]',
        },
        transport:
          process.env.NODE_ENV === 'development'
            ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss.l' } }
            : undefined,
      },
    }),

    // Request-scoped storage for tenant context and correlation ids
    ClsModule.forRoot({ global: true, middleware: { mount: true, generateId: true } }),

    // Rate limiting (per-IP default; tighter limits on /auth/login in the guard)
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),

    // Scheduled jobs (cron) — usado pelo módulo Contratos, entre outros
    ScheduleModule.forRoot(),

    // Infrastructure
    PrismaModule,
    HealthModule,

    // Feature modules
    TenantsModule,
    AuthModule,
    UsersModule,
    RolesModule,
    AuditModule,
    CrmModule,
    ContractsModule,
    ServiceOrdersModule,
    FinanceModule,
    ReportsModule,
    BackupsModule,
    RadiusModule,
  ],
})
export class AppModule {}
