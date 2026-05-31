import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { ContractsModule } from '../contracts/contracts.module';

import { EfiAutogenService } from './efi-autogen.service';
import { EfiChargesService } from './efi-charges.service';
import { EfiClientService } from './efi-client.service';
import { EfiConfigService } from './efi-config.service';
import { EfiController } from './efi.controller';
import { EfiWebhookController } from './efi-webhook.controller';

/**
 * EfiModule — pagamentos BR (Pix imediato + boleto híbrido "Bolix").
 *
 * Credenciais/certificado por tenant, cifrados (CryptoModule @Global).
 * Depende de ContractsModule pra dar baixa nas faturas (registerGatewayPayment).
 * PrismaModule e CryptoModule são @Global; AuditModule é importado.
 */
@Module({
  imports: [AuditModule, ContractsModule],
  controllers: [EfiController, EfiWebhookController],
  providers: [EfiClientService, EfiConfigService, EfiChargesService, EfiAutogenService],
  exports: [EfiChargesService, EfiConfigService],
})
export class EfiModule {}
