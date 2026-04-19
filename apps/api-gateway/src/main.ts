import 'reflect-metadata';

import helmet from 'helmet';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { VersioningType } from '@nestjs/common';
import { Logger } from 'nestjs-pino';

import { loadConfig } from '@netx/config';

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
  app.use(helmet());

  app.enableCors({
    origin:
      config.apiGateway.corsOrigins.length === 0 || config.apiGateway.corsOrigins[0] === '*'
        ? true
        : config.apiGateway.corsOrigins,
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
  console.log(
    `[api-gateway] listening on http://${config.apiGateway.host}:${config.apiGateway.port}/${config.apiGateway.globalPrefix}`,
  );
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start api-gateway:', err);
  process.exit(1);
});
