import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { ContractsModule } from '../contracts/contracts.module';
import { PortalAuthService } from './portal-auth.service';
import { PortalAccessController, PortalController } from './portal.controller';
import { PortalJwtGuard } from './portal-jwt.guard';
import { PortalService } from './portal.service';

@Module({
  imports: [AuditModule, ContractsModule],
  controllers: [PortalAccessController, PortalController],
  providers: [PortalAuthService, PortalService, PortalJwtGuard],
})
export class PortalModule {}
