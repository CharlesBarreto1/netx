import { Module } from '@nestjs/common';

import { RadiusApplierService } from './radius-applier.service';
import { RadiusCoAService } from './radius-coa.service';
import { RadiusController } from './radius.controller';

@Module({
  controllers: [RadiusController],
  providers: [RadiusApplierService, RadiusCoAService],
  exports: [RadiusApplierService, RadiusCoAService],
})
export class RadiusModule {}
