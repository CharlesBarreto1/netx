import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module.js';
import { setupTerminalProxy } from './terminal/terminal.proxy.js';
import type { Env } from './config/env.js';

async function bootstrap() {
  // Validação de entrada é feita com Zod (não class-validator/DTOs), por isso sem ValidationPipe global.
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  setupTerminalProxy(app);

  const config = app.get(ConfigService<Env, true>);
  const port = config.get('PORT', { infer: true });
  await app.listen(port);
  new Logger('bootstrap').log(`NetX NMS API ouvindo em :${port}`);
}

void bootstrap();
