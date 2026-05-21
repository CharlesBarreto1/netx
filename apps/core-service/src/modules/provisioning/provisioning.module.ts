import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { ContractsModule } from '../contracts/contracts.module';
import { CryptoModule } from '../crypto/crypto.module';

import { HuaweiSshDriver } from './drivers/huawei-ssh.driver';
import { MockOltDriver } from './drivers/mock-olt.driver';
import { NoOpOltDriver } from './drivers/noop-olt.driver';
import { OltDriverFactory } from './drivers/olt-driver.factory';
import { UfinetOrchestratorDriver } from './drivers/ufinet.driver';
import { OltsService } from './olts.service';
import { ProvisioningController, OltsController, Tr069Controller } from './provisioning.controller';
import { ProvisioningService } from './provisioning.service';
import { Tr069TasksService } from './tr069-tasks.service';

@Module({
  imports: [AuditModule, CryptoModule, ContractsModule],
  controllers: [ProvisioningController, OltsController, Tr069Controller],
  providers: [
    // Drivers
    MockOltDriver,
    NoOpOltDriver,
    UfinetOrchestratorDriver,
    HuaweiSshDriver,
    OltDriverFactory,
    // Services
    OltsService,
    Tr069TasksService,
    ProvisioningService,
  ],
  exports: [ProvisioningService, OltsService, Tr069TasksService],
})
export class ProvisioningModule {}
