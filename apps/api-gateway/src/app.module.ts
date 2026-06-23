import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { ClsModule } from 'nestjs-cls';
import { LoggerModule } from 'nestjs-pino';

import { HealthController } from './health/health.controller';
import { NmsProxyController } from './proxy/nms-proxy.controller';
import { ProxyController } from './proxy/proxy.controller';
import { EntitlementService } from './proxy/entitlement.service';
import { ProxyService } from './proxy/proxy.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),

    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        base: { service: 'api-gateway' },
        redact: {
          paths: ['req.headers.authorization', 'req.headers.cookie'],
          censor: '[REDACTED]',
        },
        transport:
          process.env.NODE_ENV === 'development'
            ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss.l' } }
            : undefined,
      },
    }),

    ClsModule.forRoot({ global: true, middleware: { mount: true, generateId: true } }),

    // Edge rate limiting: 300 req/min per IP, stricter than core services
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),

    HttpModule.register({ timeout: 15_000, maxRedirects: 0 }),
  ],
  // NmsProxyController ANTES do ProxyController (catch-all): rotas /nms/* têm
  // prioridade de match sobre o '*' genérico do Core.
  controllers: [HealthController, NmsProxyController, ProxyController],
  providers: [
    ProxyService,
    EntitlementService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
