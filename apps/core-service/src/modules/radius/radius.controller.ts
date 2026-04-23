import { Controller, Post, HttpCode } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { RequirePermissions } from '../../common/decorators';
import { RadiusApplierService } from './radius-applier.service';

/**
 * Endpoints administrativos do RADIUS.
 * Hoje só expõe um trigger manual do applier — útil para reduzir latência
 * imediatamente após uma mudança de status sem esperar o cron.
 */
@ApiTags('radius')
@ApiBearerAuth()
@Controller('radius/_tasks')
export class RadiusController {
  constructor(private readonly applier: RadiusApplierService) {}

  @Post('run-applier')
  @HttpCode(200)
  @RequirePermissions('contracts.admin')
  async runApplier() {
    const r = await this.applier.runOnce();
    return { ok: true, ...r };
  }
}
