/**
 * NetX — API Gateway entry point.
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA
 * CNPJ 57.118.236/0001-44 — São Paulo / SP — Brazil
 *
 * Public-facing edge of the NetX platform. All traffic is funnelled through
 * this gateway before reaching the internal microservices.
 *
 * @license Proprietary — see LICENSE
 * @provenance MDg0NzI5Njg5MDE=
 */
import 'reflect-metadata';

import helmet from 'helmet';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { VersioningType } from '@nestjs/common';
import { Logger } from 'nestjs-pino';

import { loadConfig, renderBootBanner } from '@netx/config';

import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/global-exception.filter';

async function bootstrap() {
  const config = loadConfig();

  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  // trust proxy (Express adapter) — para obter IP real atrás do Nginx
  (app.getHttpAdapter().getInstance() as { set: (k: string, v: unknown) => void }).set(
    'trust proxy',
    1,
  );
  // Helmet — em produção habilita HSTS por 1 ano e CSP estrita.
  // Em dev desliga CSP pra Swagger funcionar sem CDNs allowlistadas.
  app.use(
    helmet({
      contentSecurityPolicy: config.env === 'production' ? undefined : false,
      hsts:
        config.env === 'production'
          ? { maxAge: 31_536_000, includeSubDomains: true, preload: false }
          : false,
      crossOriginOpenerPolicy: { policy: 'same-origin' },
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );

  // CORS — em produção exigimos origins explícitos. Aceitar wildcard '*'
  // junto com credentials=true permitiria qualquer site externo fazer request
  // autenticado em nome de um user logado (cenário CSRF clássico). Recusamos
  // boot pra evitar configuração frágil.
  const isWildcard =
    config.apiGateway.corsOrigins.length === 0 ||
    config.apiGateway.corsOrigins[0] === '*';
  if (config.env === 'production' && isWildcard) {
    throw new Error(
      'API_GATEWAY_CORS_ORIGINS=* é proibido em produção. ' +
        'Defina os origins exatos do frontend (ex.: https://netx.exemplo.com,https://app.exemplo.com).',
    );
  }
  app.enableCors({
    origin: isWildcard ? true : config.apiGateway.corsOrigins,
    credentials: true,
  });

  app.setGlobalPrefix(config.apiGateway.globalPrefix, { exclude: ['health', 'metrics'] });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  app.useGlobalFilters(new GlobalExceptionFilter());

  if (config.env !== 'production') {
    const doc = new DocumentBuilder()
      .setTitle('NetX API Gateway')
      .setDescription('Gateway público do NetX — roteia para os microsserviços internos')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, doc);
    SwaggerModule.setup(`${config.apiGateway.globalPrefix}/docs`, app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  app.enableShutdownHooks();
  await app.listen(config.apiGateway.port, config.apiGateway.host);

  // eslint-disable-next-line no-console
  console.log(renderBootBanner('api-gateway'));
  // eslint-disable-next-line no-console
  console.log(
    `[api-gateway] listening on http://${config.apiGateway.host}:${config.apiGateway.port}/${config.apiGateway.globalPrefix}`,
  );
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start api-gateway:', err);
  process.exit(1);
});
