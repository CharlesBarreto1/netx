import 'reflect-metadata';

import helmet from 'helmet';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { loadConfig } from '@netx/config';

async function bootstrap() {
  const config = loadConfig();

  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  // Security headers
  app.use(helmet());

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

  // eslint-disable-next-line no-console
  console.log(
    `[core-service] listening on http://${config.coreService.host}:${config.coreService.port}`,
  );
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start core-service:', err);
  process.exit(1);
});
