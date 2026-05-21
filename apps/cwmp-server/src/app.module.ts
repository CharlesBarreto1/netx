import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';

import { CwmpModule } from './cwmp/cwmp.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        base: { service: 'cwmp-server' },
        // CWMP body é XML grande. Pra não poluir log, só registramos
        // resumo (method/url/status). Detalhes do payload ficam no
        // CwmpSessionService com debug level.
        autoLogging: { ignore: () => false },
        redact: {
          paths: ['req.headers.authorization', 'req.headers.cookie'],
          censor: '[REDACTED]',
        },
        transport:
          process.env.NODE_ENV === 'development'
            ? {
                target: 'pino-pretty',
                options: { colorize: true, translateTime: 'HH:MM:ss.l' },
              }
            : undefined,
      },
    }),
    PrismaModule,
    CwmpModule,
  ],
})
export class AppModule {}
