import { Module } from '@nestjs/common';
import { PlaybooksController } from './playbooks.controller.js';
import { PlaybooksService } from './playbooks.service.js';
import { DevicesModule } from '../devices/devices.module.js';

@Module({
  imports: [DevicesModule],
  controllers: [PlaybooksController],
  providers: [PlaybooksService],
})
export class PlaybooksModule {}
