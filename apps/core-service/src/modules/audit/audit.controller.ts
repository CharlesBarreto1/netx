import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuditLevel } from '@prisma/client';
import type { AuthenticatedPrincipal } from '@netx/shared';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { AuditService } from './audit.service';

const VALID_LEVELS: ReadonlySet<AuditLevel> = new Set([
  'INFO',
  'WARNING',
  'ERROR',
  'SECURITY',
] as AuditLevel[]);

@ApiTags('audit')
@ApiBearerAuth()
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  /**
   * GET /v1/audit/logs — listagem da trilha de auditoria.
   *
   * Filtros (todos opcionais):
   *   - action      → contém (insensitive) — ex.: "login", "contracts.created"
   *   - userId      → uuid do ator
   *   - resource    → "contracts", "customers", "users", ...
   *   - resourceId  → casado com resource pra timeline por entidade
   *   - level       → INFO | WARNING | ERROR | SECURITY
   *   - dateFrom    → ISO 8601 (inclusivo)
   *   - dateTo      → ISO 8601 (inclusivo)
   *   - search      → texto livre em action/resourceId
   */
  @Get('logs')
  @RequirePermissions('audit.read')
  async list(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('action') action?: string,
    @Query('userId') userId?: string,
    @Query('resource') resource?: string,
    @Query('resourceId') resourceId?: string,
    @Query('level') level?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('search') search?: string,
  ) {
    let lvl: AuditLevel | undefined;
    if (level) {
      const upper = level.toUpperCase() as AuditLevel;
      if (!VALID_LEVELS.has(upper)) {
        throw new BadRequestException(
          `Level inválido: ${level}. Use INFO | WARNING | ERROR | SECURITY.`,
        );
      }
      lvl = upper;
    }

    return this.audit.list({
      tenantId: user.tenantId,
      page: Math.max(1, Number(page) || 1),
      pageSize: Math.min(100, Math.max(1, Number(pageSize) || 20)),
      action: action || undefined,
      userId: userId || undefined,
      resource: resource || undefined,
      resourceId: resourceId || undefined,
      level: lvl,
      dateFrom: dateFrom ? new Date(dateFrom) : undefined,
      dateTo: dateTo ? new Date(dateTo) : undefined,
      search: search || undefined,
    });
  }
}
