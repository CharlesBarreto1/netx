/**
 * Endpoints OIDC — discovery, authorize, token, jwks, userinfo.
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Todas as rotas são @Public(): o cliente OIDC (Nextcloud) não tem — nem pode
 * ter — um JWT interno do NetX para chegar aqui. É justamente este endpoint que
 * emite identidade. @Public() também libera o LicenseGuard, o que é desejado:
 * uma licença vencida não deve trancar a equipe para fora dos próprios
 * arquivos e do chat.
 *
 * A resposta é escrita pelo oidc-provider direto no `res` cru (@Res() sem
 * passthrough), porque a lib controla status, headers, redirects e corpo.
 */
import { All, Controller, Param, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { Public } from '../../common/decorators';

import { OidcProviderService } from './oidc-provider.service';

@ApiExcludeController() // o discovery é a documentação destes endpoints
@Controller('oidc')
export class OidcController {
  constructor(private readonly provider: OidcProviderService) {}

  /** Raiz do issuer do tenant. */
  @Public()
  @All(':tenantSlug')
  async root(
    @Param('tenantSlug') tenantSlug: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    await this.provider.handle(tenantSlug, req, res);
  }

  /** Todo o resto: /.well-known/..., /auth, /token, /jwks, /me, /session/end. */
  @Public()
  @All(':tenantSlug/*')
  async any(
    @Param('tenantSlug') tenantSlug: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    await this.provider.handle(tenantSlug, req, res);
  }
}
