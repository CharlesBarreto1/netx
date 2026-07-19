/**
 * OidcModule — o Core como OIDC Provider.
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Expõe a gestão de chaves de assinatura e o provider em si, montado em
 * /v1/oidc/<tenant-slug>. O fluxo de "interaction" (a tela que autentica o
 * humano) é peça separada.
 *
 * CryptoModule não é importado porque é @Global.
 */
import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';

import { OidcController } from './oidc.controller';
import { OidcKeyService } from './oidc-key.service';
import { OidcProviderService } from './oidc-provider.service';

@Module({
  imports: [AuditModule],
  controllers: [OidcController],
  providers: [OidcKeyService, OidcProviderService],
  exports: [OidcKeyService, OidcProviderService],
})
export class OidcModule {}
