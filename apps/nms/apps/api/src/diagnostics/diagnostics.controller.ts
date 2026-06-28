import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { z } from 'zod';

import { CurrentUser, Roles } from '../auth/auth.decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';

import { NetworkTestService } from './network-test.service.js';

const NetworkTestSchema = z.object({
  testType: z.enum(['ping', 'traceroute']).default('ping'),
  target: z.string().min(1).max(255),
  source: z.enum(['host', 'device']).default('host'),
  device: z.string().max(120).optional(),
});
type NetworkTestBody = z.infer<typeof NetworkTestSchema>;

/**
 * Diagnóstico ativo (read-only) disparado pelo copiloto: enfileira ping/trace e
 * devolve jobId; o resultado é consultado por polling (não bloqueia a request).
 */
@Controller('diagnostics')
export class DiagnosticsController {
  constructor(private readonly networkTest: NetworkTestService) {}

  @Roles('admin', 'operator')
  @Post('network-test')
  run(
    @Body(new ZodValidationPipe(NetworkTestSchema)) body: NetworkTestBody,
    @CurrentUser() user: AuthUser,
  ) {
    return this.networkTest.enqueue(body, user.username);
  }

  @Roles('admin', 'operator', 'viewer')
  @Get('network-test/:jobId')
  status(@Param('jobId', ParseUUIDPipe) jobId: string) {
    return this.networkTest.getStatus(jobId);
  }
}
