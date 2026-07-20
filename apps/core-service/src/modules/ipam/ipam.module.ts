import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { CryptoModule } from '../crypto/crypto.module';
import { IpamAddressesService } from './addresses.service';
import { IpamCgnatService } from './cgnat.service';
import { IpamController } from './ipam.controller';
import { IpamLookupService } from './lookup.service';
import { IpamPoolsService } from './pools.service';
import { IpamPrefixesService } from './prefixes.service';
import { IpamReconcileService } from './reconcile.service';
import { MikrotikIpCollector } from './mikrotik.collector';
import { IpamSyncService } from './ipam-sync.service';
import { IpamVrfsService } from './vrfs.service';

/**
 * IPAM — documentação de IPs (estilo phpIPAM/NetBox) + CGNAT determinístico.
 * Exporta IpamSyncService pra que ContractsModule e NetworkModule espelhem
 * automaticamente os IPs fixos/gerência no IPAM.
 */
@Module({
  imports: [AuditModule, CryptoModule],
  controllers: [IpamController],
  providers: [
    IpamVrfsService,
    IpamPrefixesService,
    IpamAddressesService,
    IpamPoolsService,
    IpamCgnatService,
    IpamLookupService,
    IpamSyncService,
    IpamReconcileService,
    MikrotikIpCollector,
  ],
  exports: [IpamSyncService, IpamAddressesService],
})
export class IpamModule {}
