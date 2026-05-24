import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { MobileDevicesController } from './mobile-devices.controller';
import { MobileDevicesService } from './mobile-devices.service';

/**
 * Módulo do app NetX Mobile (Expo + React Native) — Fase 0: pareamento
 * de devices. Fases seguintes adicionam controllers de sync (pull/push) e
 * uploads (presign MinIO).
 */
@Module({
  imports: [AuditModule],
  controllers: [MobileDevicesController],
  providers: [MobileDevicesService],
  exports: [MobileDevicesService],
})
export class MobileModule {}
