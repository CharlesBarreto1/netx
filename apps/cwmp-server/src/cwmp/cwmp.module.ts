import { Module } from '@nestjs/common';

import { CwmpController } from './cwmp.controller';
import { FirmwareController } from './firmware.controller';
import { CwmpSessionService } from './cwmp-session.service';

@Module({
  controllers: [CwmpController, FirmwareController],
  providers: [CwmpSessionService],
  exports: [CwmpSessionService],
})
export class CwmpModule {}
