import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import type { AuthenticatedPrincipal } from '@netx/shared';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { BackupsService } from './backups.service';

@ApiTags('backups')
@ApiBearerAuth()
@Controller('backups')
export class BackupsController {
  constructor(private readonly backups: BackupsService) {}

  @Get()
  @RequirePermissions('backups.manage')
  list(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.backups.list(user.tenantId);
  }

  @Post()
  @RequirePermissions('backups.manage')
  create(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.backups.create(user.tenantId, user.sub);
  }

  /**
   * Streaming download. O frontend usa <a href> direto pra essa URL.
   * Content-Disposition força o download com filename original.
   */
  @Get(':id/download')
  @RequirePermissions('backups.manage')
  async download(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res() res: Response,
  ): Promise<void> {
    const { filename, sizeBytes, stream } = await this.backups.download(
      user.tenantId,
      id,
    );
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename.replace(/"/g, '')}"`,
    );
    if (sizeBytes) res.setHeader('Content-Length', String(sizeBytes));
    stream.pipe(res);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('backups.manage')
  async remove(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.backups.remove(user.tenantId, user.sub, id);
  }
}
