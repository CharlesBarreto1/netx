import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { DisconnectModule } from '../disconnect/disconnect.module';
import { FibermapModule } from '../fibermap/fibermap.module';
import { IpamModule } from '../ipam/ipam.module';
import { StockModule } from '../stock/stock.module';
import { NetworkController } from './network.controller';
import { NetworkEquipmentService } from './network-equipment.service';
import { NetworkPopsService } from './network-pops.service';
import { NmsSyncService } from './nms-sync.service';
import { RadiusNasSyncService } from './radius-nas-sync.service';

@Module({
  // StockModule: cadastrar equipamento consumindo um bem do estoque
  // (DeploymentService) na mesma transação — ver NetworkEquipmentService.create.
  // FibermapModule: cadastrar POP cria o elemento na planta óptica no mesmo
  // passo — ver NetworkPopsService.create.
  imports: [AuditModule, DisconnectModule, IpamModule, StockModule, FibermapModule],
  controllers: [NetworkController],
  providers: [
    NetworkPopsService,
    NetworkEquipmentService,
    RadiusNasSyncService,
    NmsSyncService,
  ],
  exports: [NetworkPopsService, NetworkEquipmentService, NmsSyncService],
})
export class NetworkModule {}
