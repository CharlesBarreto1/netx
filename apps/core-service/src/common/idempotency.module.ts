/**
 * IdempotencyModule — registra o IdempotencyInterceptor como interceptor global.
 * Opt-in pelo header `Idempotency-Key`: sem o header é passthrough, então não
 * altera o comportamento da web/produção atual. PrismaService é global.
 */
import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';

import { IdempotencyInterceptor } from './interceptors/idempotency.interceptor';

@Module({
  providers: [{ provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor }],
})
export class IdempotencyModule {}
