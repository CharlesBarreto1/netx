import { Module } from '@nestjs/common';

import { RadacctController } from './radacct.controller';
import { RadacctService } from './radacct.service';
import { RadiusApplierService } from './radius-applier.service';
import { RadiusAuthLogService } from './radius-auth-log.service';
import { RadiusCoAService } from './radius-coa.service';
import { RadiusController } from './radius.controller';

@Module({
  controllers: [RadiusController, RadacctController],
  providers: [
    RadiusApplierService,
    RadiusCoAService,
    RadacctService,
    RadiusAuthLogService,
  ],
  exports: [RadiusApplierService, RadiusCoAService, RadacctService],
})
export class RadiusModule {}
