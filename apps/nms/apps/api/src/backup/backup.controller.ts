import { Controller, Get, Headers, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { BackupService } from './backup.service.js';
import { CurrentUser, Roles } from '../auth/auth.decorators.js';
import type { AuthUser } from '../auth/auth.types.js';

@Controller('devices/:id')
export class BackupController {
  constructor(private readonly backup: BackupService) {}

  /** Dispara um backup manual da config. Repassa o token p/ o resumo de diff via IA do NetX. */
  @Roles('admin', 'operator')
  @Post('backup')
  run(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Headers('authorization') authz?: string,
  ) {
    return this.backup.backup(id, user.username, authz);
  }

  /** Histórico de snapshots. */
  @Get('snapshots')
  list(@Param('id', ParseUUIDPipe) id: string) {
    return this.backup.listSnapshots(id);
  }

  /** Um snapshot: config completa + diff vs anterior. */
  @Get('snapshots/:snapshotId')
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('snapshotId', ParseUUIDPipe) snapshotId: string,
  ) {
    return this.backup.getSnapshot(id, snapshotId);
  }
}
