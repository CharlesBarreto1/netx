import { Module } from '@nestjs/common';

import { AiModule } from '../ai/ai.module';

import { AlarmNotifier } from './alarm-notifier.service';
import { AlarmScopeResolver } from './alarm-scope.resolver';
import { AlarmStream } from './alarm-stream.service';
import { AlarmsController } from './alarms.controller';
import { AlarmsService } from './alarms.service';
import { IncidentAiService } from './incident-ai.service';
import { IncidentCorrelator } from './incident-correlator.service';

/**
 * Central de Alarmes CPE/OLT. Exporta IncidentCorrelator + AlarmStream pra o
 * OltSyslogCollector (ProvisioningModule) chamar in-process. Não importa o
 * ProvisioningModule (evita ciclo).
 */
@Module({
  imports: [AiModule],
  controllers: [AlarmsController],
  providers: [
    AlarmsService,
    AlarmScopeResolver,
    IncidentCorrelator,
    AlarmStream,
    IncidentAiService,
    AlarmNotifier,
  ],
  // AlarmsService sai pro NmsDashboardModule reusar `getPolicy` — os limiares
  // ópticos (rxLow/rxHigh) precisam ser os MESMOS nos dois lugares, senão o
  // painel e a central de alarmes discordam sobre o que é sinal ruim.
  exports: [IncidentCorrelator, AlarmStream, AlarmsService],
})
export class AlarmsModule {}
