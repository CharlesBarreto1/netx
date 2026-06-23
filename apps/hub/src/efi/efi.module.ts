import { Global, Module } from '@nestjs/common';

import { EfiClientService } from './efi-client.service';
import { EfiWebhookController } from './efi-webhook.controller';

/** Integração EFI (Pix). Global: o PaymentProvider usa o EfiClientService. */
@Global()
@Module({
  controllers: [EfiWebhookController],
  providers: [EfiClientService],
  exports: [EfiClientService],
})
export class EfiModule {}
