import { Controller, Get, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import {
  BrowseHubsoftCustomersRequestSchema,
  ImportHubsoftCustomersRequestSchema,
  RunHubsoftSyncRequestSchema,
  UpsertHubsoftConfigRequestSchema,
  type AuthenticatedPrincipal,
  type BrowseHubsoftCustomersRequest,
  type ImportHubsoftCustomersRequest,
  type RunHubsoftSyncRequest,
  type UpsertHubsoftConfigRequest,
} from '@netx/shared';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { ZodBody } from '../../common/zod.pipe';

import { HubsoftConfigService } from './hubsoft-config.service';
import { HubsoftImportService } from './hubsoft-import.service';

/**
 * Hubsoft — configuração (admin) + migração (listar/importar/sincronizar).
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

  // ── Migração — listar / importar seleção / sincronizar importados ───────────
  /** Lista clientes do Hubsoft (paginado, com filtros) p/ escolher quem importar. */
  @Post('customers/search')
  @RequirePermissions('hubsoft.config.read')
  search(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodBody(BrowseHubsoftCustomersRequestSchema) body: BrowseHubsoftCustomersRequest,
  ) {
    return this.importer.browse(user.tenantId, body);
  }

  /** Importa apenas a seleção (lista de codigos). */
  @Post('customers/import')
  @RequirePermissions('hubsoft.sync.write')
  importSelected(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodBody(ImportHubsoftCustomersRequestSchema) body: ImportHubsoftCustomersRequest,
  ) {
    return this.importer.run(user.tenantId, user.sub, {
      codigos: body.codigos,
      entities: body.entities,
      dryRun: body.dryRun,
    });
  }

  /** Re-sincroniza agora SÓ os clientes já importados (mesma rotina do cron). */
  @Post('sync/imported')
  @RequirePermissions('hubsoft.sync.write')
  syncImported(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.importer.run(user.tenantId, user.sub, { onlyImported: true });
  }

  /** Sync genérico/dry-run (uso avançado/diagnóstico). */
  @Post('sync')
  @RequirePermissions('hubsoft.sync.write')
  runSync(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodBody(RunHubsoftSyncRequestSchema) body: RunHubsoftSyncRequest,
  ) {
    return this.importer.run(user.tenantId, user.sub, body);
  }
}
