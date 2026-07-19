/**
 * OidcModule — o Core como OIDC Provider.
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Por ora expõe só a gestão de chaves de assinatura. O provider em si
 * (discovery, authorize, token, userinfo) entra em cima disto.
 *
 * CryptoModule não é importado porque é @Global.
 */
import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';

import { OidcKeyService } from './oidc-key.service';

@Module({
  imports: [AuditModule],
  providers: [OidcKeyService],
  exports: [OidcKeyService],
})
export class OidcModule {}
