import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { BrBillingModule } from '../br-billing/br-billing.module';
import { ContractsModule } from '../contracts/contracts.module';

import { BtgAutogenService } from './btg-autogen.service';
import { BtgChargesService } from './btg-charges.service';
import { BtgClientService } from './btg-client.service';
import { BtgConfigService } from './btg-config.service';
import { BtgController } from './btg.controller';
import { BtgOauthController } from './btg-oauth.controller';
import { BtgRecurrenceService } from './btg-recurrence.service';
import { BtgWebhookController } from './btg-webhook.controller';

/**
 * BtgModule — pagamentos BR (boleto + Pix cobrança + Pix Automático).
 *
 * Auth OAuth2 via BTG Id (Authorization Code → refresh_token cifrado). Depende
 * de ContractsModule pra dar baixa nas faturas (registerGatewayPayment).
 * Coexiste com o EfiModule; cada tenant escolhe o gateway BR ativo
 * (TenantSetting finance.br.gateway). PrismaModule e CryptoModule são @Global.
 */
@Module({
  imports: [AuditModule, BrBillingModule, ContractsModule],
  controllers: [BtgController, BtgOauthController, BtgWebhookController],
  providers: [
    BtgClientService,
    BtgConfigService,
    BtgChargesService,
    BtgRecurrenceService,
    BtgAutogenService,
  ],
  exports: [BtgConfigService, BtgChargesService, BtgRecurrenceService],
})
export class BtgModule {}
