import { Global, Module } from '@nestjs/common';

import { PaymentProvider } from './payment.provider';

@Global()
@Module({
  providers: [PaymentProvider],
  exports: [PaymentProvider],
})
export class PaymentModule {}
