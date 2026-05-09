import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  PrismaHealthIndicator,
  HealthIndicatorResult,
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

  /** Liveness + DB readiness probe. Public — usado por load balancer / k8s. */
  @Public()
  @Get()
  @HealthCheck()
  check(): Promise<{ status: string; info?: HealthIndicatorResult }> {
    return this.health.check([() => this.prismaHealth.pingCheck('database', this.prisma)]);
  }

  /** Liveness simples — não toca no DB. Public. */
  @Public()
  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
