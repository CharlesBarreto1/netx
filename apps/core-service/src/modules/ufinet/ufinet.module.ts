/**
 * UfinetModule — integração com a rede neutra Ufinet (PY, API TM Forum).
 *
 * Exporta UfinetOrdersService pros enganches no ciclo de vida do contrato
 * (ContractsModule e ProvisioningModule importam este módulo). PrismaModule e
 * CryptoModule são @Global; só AuditModule precisa ser importado.
 *
 * O UfinetPollerService roda via @Cron (ScheduleModule já está no root).
 */
import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';

import { UfinetClientService } from './ufinet-client.service';
import { UfinetController } from './ufinet.controller';
import { UfinetHealthService } from './ufinet-health.service';
import { UfinetOrdersService } from './ufinet-orders.service';
import { UfinetPollerService } from './ufinet-poller.service';

@Module({
  imports: [AuditModule],
  controllers: [UfinetController],
  providers: [
    UfinetClientService,
    UfinetHealthService,
    UfinetOrdersService,
    UfinetPollerService,
  ],
  exports: [UfinetOrdersService, UfinetClientService],
})
export class UfinetModule {}
