/**
 * Endpoints OIDC — discovery, authorize, token, jwks, userinfo e interaction.
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Todas as rotas são @Public(): o cliente OIDC (Nextcloud) não tem — nem pode
 * ter — um JWT interno do NetX para chegar aqui. É justamente este endpoint que
 * emite identidade. @Public() também libera o LicenseGuard, o que é desejado:
 * uma licença vencida não deve trancar a equipe para fora dos próprios
 * arquivos e do chat.
 *
 * ORDEM DAS ROTAS IMPORTA. As de interaction vêm ANTES do catch-all; o Nest
 * casa na ordem de declaração e `:tenantSlug/*` engoliria todas elas.
 *
 * As rotas de interaction ficam sob o mesmo caminho público do issuer de
 * propósito: o cookie `_interaction` é escrito com path restrito, e o navegador
 * só o envia para URLs abaixo dele.
 */
import { All, Body, Controller, Get, Param, Post, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { Public } from '../../common/decorators';

import { OidcInteractionService } from './oidc-interaction.service';
import { OidcProviderService } from './oidc-provider.service';

interface LoginBody {
  email?: string;
  password?: string;
  mfaToken?: string;
  remember?: boolean;
}

@ApiExcludeController() // o discovery é a documentação destes endpoints
@Controller('oidc')
export class OidcController {
  constructor(
    private readonly provider: OidcProviderService,
    private readonly interaction: OidcInteractionService,
  ) {}

  // ---------------------------------------------------------------------------
  // Interaction — precisam vir antes do catch-all
  // ---------------------------------------------------------------------------

  /** O que a tela precisa mostrar: para qual app, de qual tenant, quais escopos. */
  @Public()
  @Get(':tenantSlug/interaction/:uid/details')
  async details(
    @Param('tenantSlug') tenantSlug: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.provider.interactionDetails(tenantSlug, req, res);
  }

  /**
   * Valida credencial e conclui a interaction.
   *
   * Devolve `{ returnTo }` em vez de redirecionar: assim a tela trata erro de
   * senha sem perder a navegação, e só navega quando de fato autenticou.
   */
  @Public()
  @Post(':tenantSlug/interaction/:uid/login')
  async login(
    @Param('tenantSlug') tenantSlug: string,
    @Body() body: LoginBody,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ returnTo: string }> {
    const tenantId = await this.provider.tenantIdFor(tenantSlug);

    const userId = await this.interaction.authenticate({
      tenantId,
      email: String(body.email ?? '').trim(),
      password: String(body.password ?? ''),
      mfaToken: body.mfaToken?.trim() || undefined,
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });

    const returnTo = await this.provider.finishInteraction(
      tenantSlug,
      req,
      res,
      userId,
      body.remember !== false,
    );
    return { returnTo };
  }

  /** Usuário desistiu. O provider devolve access_denied ao cliente. */
  @Public()
  @Post(':tenantSlug/interaction/:uid/abort')
  async abort(
    @Param('tenantSlug') tenantSlug: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ returnTo: string }> {
    return { returnTo: await this.provider.abortInteraction(tenantSlug, req, res) };
  }

  // ---------------------------------------------------------------------------
  // Tudo que é servido pelo próprio oidc-provider
  // ---------------------------------------------------------------------------

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

  /** /.well-known/..., /auth, /token, /jwks, /me, /session/end. */
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
