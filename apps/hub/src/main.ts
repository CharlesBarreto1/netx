import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';

import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.setGlobalPrefix('v1', { exclude: ['health'] });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  // O Hub fica atrás de um proxy (nginx) — confia no X-Forwarded-For pra
  // registrar o IP real da instância no heartbeat.
  app.set('trust proxy', true);
  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`NetX Hub ouvindo em :${port}`);
}
void bootstrap();
