/**
 * NetX — Core Service entry point.
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA
 * CNPJ 57.118.236/0001-44 — São Paulo / SP — Brazil
 *
 * This file is part of the proprietary NetX platform. Reproduction or
 * redistribution without written authorization is prohibited.
 *
 * @license Proprietary — see LICENSE
 * @provenance Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=
 */
import 'reflect-metadata';

import helmet from 'helmet';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { loadConfig, renderBootBanner, BUILD_PROVENANCE } from '@netx/config';
import { GlobalExceptionFilter } from './common/global-exception.filter';

async function bootstrap() {
  const config = loadConfig();

  // Tipa como NestExpressApplication pra ter acesso ao `app.set()` do
  // Express subjacente — necessário pra `trust proxy` abaixo.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    // rawBody preserva o corpo cru (req.rawBody) — exigido pra validar a
    // assinatura HMAC dos webhooks WhatsApp (WAHA X-Webhook-Hmac e Meta
    // X-Hub-Signature-256), que precisa bater byte-a-byte.
    rawBody: true,
  });
  app.useLogger(app.get(Logger));

  // Trust proxy — sem isso, `req.ip` devolve sempre 127.0.0.1 porque o
  // socket peer é o api-gateway/Nginx. Com trust proxy ligado, Express lê
  // X-Forwarded-For (já populado pelo Nginx → gateway → core) e expõe o
  // IP real do cliente. Crítico pra auditoria, rate limit e MFA.
  // `true` = confia em todos os hops; OK porque core-service só recebe
  // tráfego interno (atrás do gateway). Se um dia ficar exposto direto,
  // trocar pra número de hops específico (ex.: 2).
  app.set('trust proxy', true);

  // Security headers — defesa em profundidade. Core-service só recebe
  // tráfego interno (atrás do gateway/Nginx) mas mantemos os headers caso
  // alguém exponha o port 3101 sem querer.
  app.use(
    helmet({
      contentSecurityPolicy: config.env === 'production' ? undefined : false,
      hsts:
        config.env === 'production'
          ? { maxAge: 31_536_000, includeSubDomains: true, preload: false }
          : false,
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );

  // CORS (Core Service is normally private — only API Gateway talks to it)
  app.enableCors({ origin: false });

  // Global versioned prefix
  app.setGlobalPrefix('v1', { exclude: ['health', 'metrics'] });
  app.enableVersioning({ type: VersioningType.URI });

  // Validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Filtro global RFC 7807 — todas as exceptions saem como ProblemDetails,
  // o que faz o frontend (`ApiError.friendlyMessage`) mostrar mensagens reais
  // como "PPPoE username já em uso" em vez de "HTTP 409".
  app.useGlobalFilters(new GlobalExceptionFilter());

  // Swagger (disabled in production)
  if (config.env !== 'production') {
    const doc = new DocumentBuilder()
      .setTitle('NetX — Core Service')
      .setDescription('Módulo 1: Autenticação, Multi-tenancy, Usuários, RBAC, Auditoria')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, doc);
    SwaggerModule.setup('docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  app.enableShutdownHooks();
  await app.listen(config.coreService.port, config.coreService.host);

  // Boot banner — emite em STDOUT (fora do logger estruturado) pra ficar
  // legível mesmo em jornal de systemd/docker logs.
  // eslint-disable-next-line no-console
  console.log(renderBootBanner('core-service'));
  // eslint-disable-next-line no-console
  console.log(
    `[core-service] listening on http://${config.coreService.host}:${config.coreService.port}`,
  );
  // Touch BUILD_PROVENANCE so tree-shaking/dead-code-elim doesn't drop it.
  // (Embedded provenance must survive bundling — see LICENSE §4.)
  if (process.env.NETX_PROVENANCE_DEBUG === '1') {
    // eslint-disable-next-line no-console
    console.log('[core-service] provenance', BUILD_PROVENANCE);
  }
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start core-service:', err);
  process.exit(1);
});
