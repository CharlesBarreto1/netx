import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  PrismaHealthIndicator,
  HealthIndicatorResult,
} from '@nestjs/terminus';
import { ApiTags } from '@nestjs/swagger';

import { PrismaService } from '../prisma/prisma.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prisma: PrismaService,
    private readonly prismaHealth: PrismaHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  check(): Promise<{ status: string; info?: HealthIndicatorResult }> {
    return this.health.check([() => this.prismaHealth.pingCheck('database', this.prisma)]);
  }

  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
