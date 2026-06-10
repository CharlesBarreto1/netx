import { Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { RequirePermissions } from '../../common/decorators';
import { LicenseBypass } from './license.decorators';
import { HeartbeatService } from './heartbeat.service';
import { LicensingService } from './licensing.service';

/**
 * Estado da licença desta instalação. GET /status é @LicenseBypass — precisa
 * ser legível mesmo com a licença bloqueada (o front usa pra renderizar a tela
 * de "licença expirada" em vez de quebrar).
 */
@ApiTags('license')
@ApiBearerAuth()
@Controller('license')
export class LicensingController {
  constructor(
    private readonly licensing: LicensingService,
    private readonly heartbeat: HeartbeatService,
  ) {}

  @Get('status')
  @LicenseBypass()
  status() {
    return this.licensing.status();
  }

  /** Força um heartbeat agora (debug/regularização). Admin only. */
  @Post('heartbeat')
  @LicenseBypass()
  @RequirePermissions('tenants.settings.manage')
  async refresh() {
    await this.heartbeat.beat('manual');
    return this.licensing.status();
  }
}
