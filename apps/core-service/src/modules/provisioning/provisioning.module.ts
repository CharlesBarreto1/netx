import { Module } from '@nestjs/common';

import { AlarmsModule } from '../alarms/alarms.module';
import { AuditModule } from '../audit/audit.module';
import { BrBillingModule } from '../br-billing/br-billing.module';
import { ContractsModule } from '../contracts/contracts.module';
import { CryptoModule } from '../crypto/crypto.module';
import { FibermapModule } from '../fibermap/fibermap.module';
import { StockModule } from '../stock/stock.module';
import { UfinetModule } from '../ufinet/ufinet.module';

import { HuaweiSshDriver } from './drivers/huawei-ssh.driver';
import { MockOltDriver } from './drivers/mock-olt.driver';
import { NoOpOltDriver } from './drivers/noop-olt.driver';
import { OltDriverFactory } from './drivers/olt-driver.factory';
import { UfinetOrchestratorDriver } from './drivers/ufinet.driver';
import { ZyxelZynosDriver } from './drivers/zyxel-zynos.driver';
import { OltProvisioningProfilesService } from './olt-provisioning-profiles.service';
import { OltSyslogCollector } from './olt-syslog.collector';
import { OltsService } from './olts.service';
import {
  ProvisioningController,
  OltsController,
  OltProvisioningProfilesController,
  Tr069Controller,
} from './provisioning.controller';
import { ProvisioningService } from './provisioning.service';
import { Tr069ConfigService } from './tr069-config.service';
import { Tr069FirmwareService } from './tr069-firmware.service';
import { Tr069DiagnosticsService } from './tr069-diagnostics.service';
import { Tr069ProfilesService } from './tr069-profiles.service';
import { Tr069ReconcileService } from './tr069-reconcile.service';
import { Tr069TasksService } from './tr069-tasks.service';
import { WifiOptController } from './wifi-opt.controller';
import { WifiOptRolloutService } from './wifi-opt-rollout.service';
import { WifiOptService } from './wifi-opt.service';

@Module({
  imports: [AlarmsModule, AuditModule, BrBillingModule, CryptoModule, ContractsModule, FibermapModule, StockModule, UfinetModule],
  controllers: [
    ProvisioningController,
    OltsController,
    OltProvisioningProfilesController,
    Tr069Controller,
    WifiOptController,
  ],
  providers: [
    // Drivers
    MockOltDriver,
    NoOpOltDriver,
    UfinetOrchestratorDriver,
    HuaweiSshDriver,
    ZyxelZynosDriver,
    OltDriverFactory,
    // Services
    OltsService,
    OltProvisioningProfilesService,
    OltSyslogCollector,
    Tr069TasksService,
    Tr069DiagnosticsService,
    Tr069ReconcileService,
    Tr069ProfilesService,
    Tr069ConfigService,
    Tr069FirmwareService,
    WifiOptService,
    WifiOptRolloutService,
    ProvisioningService,
  ],
  exports: [
    ProvisioningService,
    OltsService,
    OltProvisioningProfilesService,
    Tr069TasksService,
    Tr069DiagnosticsService,
    Tr069ReconcileService,
    Tr069ProfilesService,
    // WifiOptService: consumido pelo WifiOptEventsHandler (event-bus.module).
    WifiOptService,
  ],
})
export class ProvisioningModule {}
