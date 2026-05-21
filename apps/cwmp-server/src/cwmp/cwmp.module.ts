import { Module } from '@nestjs/common';

import { CwmpController } from './cwmp.controller';
import { CwmpSessionService } from './cwmp-session.service';

@Module({
  controllers: [CwmpController],
  providers: [CwmpSessionService],
  exports: [CwmpSessionService],
})
export class CwmpModule {}
