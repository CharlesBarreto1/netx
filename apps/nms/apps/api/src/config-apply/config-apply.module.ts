import { Module } from '@nestjs/common';
import { ConfigApplyController } from './config-apply.controller.js';
import { ConfigApplyService } from './config-apply.service.js';
import { DevicesModule } from '../devices/devices.module.js';

@Module({
  imports: [DevicesModule],
  controllers: [ConfigApplyController],
  providers: [ConfigApplyService],
})
export class ConfigApplyModule {}
