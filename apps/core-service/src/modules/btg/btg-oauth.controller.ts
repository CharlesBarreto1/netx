import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { Public } from '../../common/decorators';

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
    @Res() res: Response,
  ): Promise<void> {
    const target = (process.env.BTG_OAUTH_SUCCESS_REDIRECT ?? '/settings/btg').replace(/\/+$/, '');
    if (error || !code || !state) {
      res.redirect(302, `${target}?btg=error`);
      return;
    }
    try {
      await this.config.handleCallback(state, code);
      res.redirect(302, `${target}?btg=ok`);
    } catch {
      res.redirect(302, `${target}?btg=error`);
    }
  }
}
