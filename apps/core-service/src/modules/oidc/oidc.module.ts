/**
 * OidcModule — o Core como OIDC Provider.
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Expõe as chaves de assinatura, o provider montado em /v1/oidc/<tenant-slug>,
 * e a autenticação do humano no fluxo de interaction.
 *
 * AuthModule entra por causa do MfaService: o login do SSO exige o mesmo
 * segundo fator do login interno, senão o SSO vira um desvio da MFA.
 *
 * CryptoModule não é importado porque é @Global.
 */
import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';

import { OidcController } from './oidc.controller';
import { OidcInteractionService } from './oidc-interaction.service';
import { OidcKeyService } from './oidc-key.service';
import { OidcProviderService } from './oidc-provider.service';

@Module({
  imports: [AuditModule, AuthModule],
  controllers: [OidcController],
  providers: [OidcKeyService, OidcProviderService, OidcInteractionService],
  exports: [OidcKeyService, OidcProviderService, OidcInteractionService],
})
export class OidcModule {}
