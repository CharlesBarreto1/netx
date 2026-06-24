import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';

import { HubsoftClientService } from './hubsoft-client.service';
import { HubsoftConfigService } from './hubsoft-config.service';
import { HubsoftController } from './hubsoft.controller';
import { HubsoftImportService } from './hubsoft-import.service';
import { HubsoftSyncService } from './hubsoft-sync.service';

/**
 * HubsoftModule — integração de LEITURA com a API oficial do Hubsoft, usada na
 * migração/operação conjunta de um provedor. Puxa clientes, contratos e
 * financeiro e espelha nos modelos do NetX. Credenciais por tenant cifradas
 * (CryptoModule @Global). PrismaModule e CryptoModule são @Global; AuditModule
 * é importado.
 */
@Module({
  imports: [AuditModule],
  controllers: [HubsoftController],
  providers: [
    HubsoftClientService,
    HubsoftConfigService,
    HubsoftImportService,
    HubsoftSyncService,
  ],
  exports: [HubsoftConfigService, HubsoftImportService],
})
export class HubsoftModule {}
