import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckResult,
  HealthCheckService,
  PrismaHealthIndicator,
} from '@nestjs/terminus';
import { ApiTags } from '@nestjs/swagger';

import { Public } from '../../common/decorators';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prisma: PrismaService,
    private readonly prismaHealth: PrismaHealthIndicator,
  ) {}

  /**
   * Liveness + DB readiness probe. Public — usado por load balancer / k8s.
   *
   * Em `@nestjs/terminus` 11 o tipo de retorno é `HealthCheckResult` (que já
   * carrega status + info + details). Não criamos mais a anotação manual
   * `{ status; info? }` — gerava conflito de strict type em TS 5.9.
   */
  @Public()
  @Get()
  @HealthCheck()
  check(): Promise<HealthCheckResult> {
    return this.health.check([() => this.prismaHealth.pingCheck('database', this.prisma)]);
  }

  /** Liveness simples — não toca no DB. Public. */
  @Public()
  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
