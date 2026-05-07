import { Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedPrincipal } from '@netx/shared';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { RadiusApplierService } from './radius-applier.service';
import { RadiusAuthLogService } from './radius-auth-log.service';

/**
 * Endpoints administrativos do RADIUS.
 *   - POST /radius/_tasks/run-applier — força aplicação imediata de eventos
 *   - GET  /radius/auth-log           — log de tentativas de autenticação
 */
@ApiTags('radius')
@ApiBearerAuth()
@Controller('radius')
export class RadiusController {
  constructor(
    private readonly applier: RadiusApplierService,
    private readonly authLog: RadiusAuthLogService,
  ) {}

  @Post('_tasks/run-applier')
  @HttpCode(200)
  @RequirePermissions('contracts.admin')
  async runApplier() {
    const r = await this.applier.runOnce();
    return { ok: true, ...r };
  }

  @Get('auth-log')
  @RequirePermissions('audit.read')
  async listAuthLog(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '50',
    @Query('username') username?: string,
    @Query('status') status?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.authLog.list(user.tenantId, {
      page: Number(page) || 1,
      pageSize: Number(pageSize) || 50,
      username: username || undefined,
      status:
        status === 'accepted' || status === 'rejected'
          ? status
          : undefined,
      dateFrom: dateFrom ? new Date(dateFrom) : undefined,
      dateTo: dateTo ? new Date(dateTo) : undefined,
    });
  }
}
