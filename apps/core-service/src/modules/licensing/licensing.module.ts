import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { HeartbeatService } from './heartbeat.service';
import { LicenseGuard } from './license.guard';
import { LicensingController } from './licensing.controller';
import { LicensingService } from './licensing.service';
import { ModuleEntitlementGuard } from './module-entitlement.guard';
// Side-effect: popula o registry de manifestos (apiPrefixes) no boot.
import './module-manifests';

/**
 * Licenciamento — valida a licença DESTA instalação com o Hub da NetX.
 *
 * Registra o LicenseGuard como terceiro APP_GUARD (depois de JWT e Permissions
 * via AuthModule). FAIL-OPEN: se o licenciamento está desligado (sem
 * NETX_HUB_URL/NETX_LICENSE_KEY), o guard libera tudo. Ver docs/licensing.md.
 */
@Module({
  controllers: [LicensingController],
  providers: [
    LicensingService,
    HeartbeatService,
    { provide: APP_GUARD, useClass: LicenseGuard },
    { provide: APP_GUARD, useClass: ModuleEntitlementGuard },
  ],
  exports: [LicensingService],
})
export class LicensingModule {}
