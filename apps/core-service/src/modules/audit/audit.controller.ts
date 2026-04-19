import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedPrincipal } from '@netx/shared';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { AuditService } from './audit.service';

@ApiTags('audit')
@ApiBearerAuth()
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get('logs')
  @RequirePermissions('audit.read')
  async list(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('action') action?: string,
  ) {
    return this.audit.list({
      tenantId: user.tenantId,
      page: Math.max(1, Number(page)),
      pageSize: Math.min(100, Math.max(1, Number(pageSize))),
      action,
    });
  }
}
