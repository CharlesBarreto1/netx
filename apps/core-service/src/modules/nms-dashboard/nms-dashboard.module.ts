import { Module } from '@nestjs/common';

import { AlarmsModule } from '../alarms/alarms.module';
import { RadiusModule } from '../radius/radius.module';

import { NmsClientService } from './nms-client.service';
import { NmsDashboardController } from './nms-dashboard.controller';
import { NmsDashboardService } from './nms-dashboard.service';
import { NetworkSnapshotService } from './network-snapshot.service';

/**
 * Painel do NOC + o coletor que lhe dá memória.
 *
 * Importa RadiusModule (contagem de sessões) e AlarmsModule (limiares ópticos
 * da AlarmPolicy — reusados em vez de redefinidos, pra que o painel e a
 * central de alarmes nunca discordem sobre o que é "sinal ruim").
 */
@Module({
  imports: [RadiusModule, AlarmsModule],
  controllers: [NmsDashboardController],
  providers: [NmsDashboardService, NmsClientService, NetworkSnapshotService],
  exports: [NmsDashboardService],
})
export class NmsDashboardModule {}
