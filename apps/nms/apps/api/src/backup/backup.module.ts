import { Module } from '@nestjs/common';
import { BackupController } from './backup.controller.js';
import { BackupService } from './backup.service.js';
import { BackupScheduler } from './backup.scheduler.js';
import { DevicesModule } from '../devices/devices.module.js';

@Module({
  imports: [DevicesModule],
  controllers: [BackupController],
  providers: [BackupService, BackupScheduler],
  exports: [BackupService],
})
export class BackupModule {}
