import { Module } from '@nestjs/common';
import { DevicesController } from './devices.controller.js';
import { DevicesService } from './devices.service.js';
import { CredentialsService } from './credentials.service.js';
import { ConnectivityService } from './connectivity.service.js';
import { SnmpConfigService } from './snmp-config.service.js';
import { SnmpConfigReconciler } from './snmp-config.reconciler.js';
import { DiscoveryService } from './discovery.service.js';

@Module({
  controllers: [DevicesController],
  providers: [
    DevicesService,
    CredentialsService,
    ConnectivityService,
    SnmpConfigService,
    SnmpConfigReconciler,
    DiscoveryService,
  ],
  exports: [DevicesService],
})
export class DevicesModule {}
