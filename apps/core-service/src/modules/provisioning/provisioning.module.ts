import { Module } from '@nestjs/common';

import { AlarmsModule } from '../alarms/alarms.module';
import { AuditModule } from '../audit/audit.module';
import { BrBillingModule } from '../br-billing/br-billing.module';
import { ContractsModule } from '../contracts/contracts.module';
import { CryptoModule } from '../crypto/crypto.module';
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
import { Tr069DiagnosticsService } from './tr069-diagnostics.service';
import { Tr069ProfilesService } from './tr069-profiles.service';
import { Tr069ReconcileService } from './tr069-reconcile.service';
import { Tr069TasksService } from './tr069-tasks.service';

@Module({
  imports: [AlarmsModule, AuditModule, BrBillingModule, CryptoModule, ContractsModule, StockModule, UfinetModule],
  controllers: [
    ProvisioningController,
    OltsController,
    OltProvisioningProfilesController,
    Tr069Controller,
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
  ],
})
export class ProvisioningModule {}
