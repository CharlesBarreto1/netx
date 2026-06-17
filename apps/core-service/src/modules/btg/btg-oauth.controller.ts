import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { Public } from '../../common/decorators';

import { BtgApiError } from './btg-client.service';
import { BtgConfigService } from './btg-config.service';

/**
 * Callback público do consentimento BTG (Authorization Code).
 *
 * O BTG Id redireciona o NAVEGADOR do admin para cá com ?code&state. Não há
 * JWT (é uma navegação do browser), por isso a rota é @Public — a defesa é o
 * `state` aleatório que casamos com o BtgConfig do tenant. Após trocar o code
 * por tokens, redirecionamos de volta pra tela de settings do front.
 */
@ApiTags('btg')
@Controller('btg/oauth')
export class BtgOauthController {
  constructor(private readonly config: BtgConfigService) {}

  @Public()
  @Get('callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Query('error_description') errorDescription: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const target = (process.env.BTG_OAUTH_SUCCESS_REDIRECT ?? '/settings/btg').replace(/\/+$/, '');
    const fail = (reason: string) =>
      res.redirect(302, `${target}?btg=error&reason=${encodeURIComponent(reason.slice(0, 300))}`);

    if (error || !code || !state) {
      // BTG mandou um erro pro callback (ex.: consentimento negado) — propaga.
      fail(errorDescription || error || 'callback sem code/state');
      return;
    }
    try {
      await this.config.handleCallback(state, code);
      res.redirect(302, `${target}?btg=ok`);
    } catch (e) {
      // Erro ao trocar o code por token (ex.: redirect_uri mismatch) — propaga
      // a mensagem real do BTG quando disponível (BtgApiError.body).
      const reason =
        e instanceof BtgApiError
          ? `${e.message}: ${JSON.stringify(e.body)}`
          : e instanceof Error
            ? e.message
            : String(e);
      fail(reason);
    }
  }
}
