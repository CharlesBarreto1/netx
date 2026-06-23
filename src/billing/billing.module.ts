import { Global, Module } from '@nestjs/common';

import { BillingService } from './billing.service';
import { TrustUnlockService } from './trust-unlock.service';

/** Faturamento + desbloqueio em confiança. Global: heartbeat usa isDelinquent. */
@Global()
@Module({
  providers: [BillingService, TrustUnlockService],
  exports: [BillingService, TrustUnlockService],
})
export class BillingModule {}
