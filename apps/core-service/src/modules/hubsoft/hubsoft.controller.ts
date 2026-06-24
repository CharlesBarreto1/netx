import { Controller, Get, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import {
  RunHubsoftSyncRequestSchema,
  UpsertHubsoftConfigRequestSchema,
  type AuthenticatedPrincipal,
  type RunHubsoftSyncRequest,
  type UpsertHubsoftConfigRequest,
} from '@netx/shared';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { ZodBody } from '../../common/zod.pipe';

import { HubsoftConfigService } from './hubsoft-config.service';
import { HubsoftImportService } from './hubsoft-import.service';

/**
 * Hubsoft — configuração (admin) e sync read-only para migração.
 * Toda escrita acontece no NetX; o Hubsoft é apenas lido.
 */
@ApiTags('hubsoft')
@ApiBearerAuth()
@Controller('hubsoft')
export class HubsoftController {
  constructor(
    private readonly config: HubsoftConfigService,
    private readonly importer: HubsoftImportService,
  ) {}

  // ── Config ─────────────────────────────────────────────────────────────────
  @Get('config')
  @RequirePermissions('hubsoft.config.read')
  getConfig(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.config.get(user.tenantId);
  }

  @Put('config')
  @RequirePermissions('hubsoft.config.write')
  upsertConfig(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodBody(UpsertHubsoftConfigRequestSchema) body: UpsertHubsoftConfigRequest,
  ) {
    return this.config.upsert(user.tenantId, user.sub, body);
  }

  /** "Testar conexão" — OAuth password grant, sem importar nada. */
  @Get('config/diagnostics')
  @RequirePermissions('hubsoft.config.read')
  diagnostics(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.config.diagnose(user.tenantId);
  }

  // ── Sync ────────────────────────────────────────────────────────────────────
  /**
   * Dispara um sync sob demanda. Use { dryRun: true } para conferir o
   * mapeamento (busca + mapeia + devolve preview SEM gravar).
   */
  @Post('sync')
  @RequirePermissions('hubsoft.sync.write')
  runSync(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodBody(RunHubsoftSyncRequestSchema) body: RunHubsoftSyncRequest,
  ) {
    return this.importer.run(user.tenantId, user.sub, body);
  }
}
