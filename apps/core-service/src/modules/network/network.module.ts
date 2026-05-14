import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { DisconnectModule } from '../disconnect/disconnect.module';
import { NetworkController } from './network.controller';
import { NetworkEquipmentService } from './network-equipment.service';
import { NetworkPopsService } from './network-pops.service';
import { RadiusNasSyncService } from './radius-nas-sync.service';

@Module({
  imports: [AuditModule, DisconnectModule],
  controllers: [NetworkController],
  providers: [NetworkPopsService, NetworkEquipmentService, RadiusNasSyncService],
  exports: [NetworkPopsService, NetworkEquipmentService],
})
export class NetworkModule {}
