import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

import { AdminModule } from './admin/admin.module';
import { BillingModule } from './billing/billing.module';
import { EfiModule } from './efi/efi.module';
import { HealthController } from './health.controller';
import { InstancesModule } from './instances/instances.module';
import { PaymentModule } from './payments/payment.module';
import { PortalModule } from './portal/portal.module';
import { PrismaModule } from './prisma/prisma.module';
import { SigningModule } from './signing/signing.module';
import { WikiModule } from './wiki/wiki.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule,
    SigningModule,
    EfiModule,
    PaymentModule,
    BillingModule,
    InstancesModule,
    AdminModule,
    PortalModule,
    WikiModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
