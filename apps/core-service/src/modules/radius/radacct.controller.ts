/**
 * Endpoints de leitura do accounting RADIUS por contrato.
 *   - GET /v1/contracts/:id/session — status atual (online/offline + IP)
 *   - GET /v1/contracts/:id/usage   — consumo de banda por dia (últimos N dias)
 */
import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedPrincipal } from '@netx/shared';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { RadacctService } from './radacct.service';

@ApiTags('contracts')
@ApiBearerAuth()
@Controller('contracts')
export class RadacctController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly radacct: RadacctService,
  ) {}

  @Get(':id/session')
  @RequirePermissions('contracts.read')
  async session(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const c = await this.prisma.contract.findFirst({
      where: { id, tenantId: user.tenantId, deletedAt: null },
      select: { pppoeUsername: true, macAddress: true, circuitId: true },
    });
    if (!c) throw new NotFoundException();
    const session = await this.radacct.getCurrentSession(c);
    // Devolve mesmo se null — frontend mostra "sin datos de RADIUS".
    return session ?? { online: false, framedIp: null, sessionStart: null, sessionStop: null, uptimeSeconds: 0, inputBytes: 0, outputBytes: 0, terminateCause: null, nasIp: null };
  }

  @Get(':id/usage')
  @RequirePermissions('contracts.read')
  async usage(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('days') daysRaw = '30',
  ) {
    const c = await this.prisma.contract.findFirst({
      where: { id, tenantId: user.tenantId, deletedAt: null },
      select: { pppoeUsername: true, macAddress: true, circuitId: true },
    });
    if (!c) throw new NotFoundException();
    const days = Math.max(1, Math.min(180, Number(daysRaw) || 30));
    const data = await this.radacct.getDailyUsage(c, days);
    const totals = data.reduce(
      (acc, d) => ({
        input: acc.input + d.inputBytes,
        output: acc.output + d.outputBytes,
      }),
      { input: 0, output: 0 },
    );
    return { days, data, totals };
  }
}
