/**
 * NetX — CWMP/TR-069 ACS entry point.
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Daemon TR-069 (porta 7547 por default) que aceita conexões CWMP de CPEs
 * Huawei EG8145V5/X10. Sem auth no MVP — firewall regra restringe origem.
 *
 * @license Proprietary — see LICENSE
 * @provenance Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=
 */
import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import express from 'express';

import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  // CWMP body é XML — usar raw body, não JSON parser. Limite alto pq
  // GetParameterValuesResponse de CPE com data model completo pode ter 200KB.
  app.use(
    '/cwmp',
    express.raw({ type: ['text/xml', 'application/xml', 'application/soap+xml', '*/*'], limit: '2mb' }),
  );
  app.use(
    '/',
    express.raw({ type: ['text/xml', 'application/xml', 'application/soap+xml', '*/*'], limit: '2mb' }),
  );

  // trust proxy — para obter IP real do CPE atrás de NAT/orquestrador
  (app.getHttpAdapter().getInstance() as { set: (k: string, v: unknown) => void }).set(
    'trust proxy',
    1,
  );

  const port = parseInt(process.env.CWMP_PORT ?? '7547', 10);
  const host = process.env.CWMP_HOST ?? '0.0.0.0';

  await app.listen(port, host);

  // eslint-disable-next-line no-console
  console.log(
    `[cwmp-server] listening on http://${host}:${port}  (env=${process.env.NODE_ENV ?? 'production'})`,
  );
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[cwmp-server] fatal bootstrap error', err);
  process.exit(1);
});
