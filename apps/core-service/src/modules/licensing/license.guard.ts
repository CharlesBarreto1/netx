import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { IS_PUBLIC_KEY } from '../../common/decorators';
import { LicensingService } from './licensing.service';
import { LICENSE_BYPASS_KEY } from './license.decorators';

/**
 * LicenseGuard — terceiro guard global (depois de JWT e Permissions). Bloqueia
 * a API de OPERADOR com 402 quando a licença desta instalação não está em dia.
 *
 * FAIL-OPEN e cirúrgico:
 *   - Licenciamento desligado (sem hubUrl/key)  → libera (currentDecision null).
 *   - Rota @Public (login, health, portal, webhooks) → libera. O dono precisa
 *     conseguir logar e ver a tela "licença expirada"; o portal do assinante e
 *     o RADIUS não podem cair por licença.
 *   - Rota @LicenseBypass (status da licença)    → libera.
 *   - effect ALLOW | GRACE                        → libera (graça = só banner).
 *   - effect BLOCK_UI | BLOCK_UI_PROVISIONING     → 402 nas rotas de operador.
 *
 * Obs.: o degrau UI_AND_PROVISIONING (bloquear só provisionamento, deixar o
 * resto) é aplicado por um guard de rota específico nas rotas de ativação, não
 * aqui — aqui ambos os efeitos de bloqueio travam a UI de operador igual.
 */
@Injectable()
export class LicenseGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly licensing: LicensingService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    // Só HTTP — crons/RPC não passam por aqui de qualquer forma.
    if (context.getType() !== 'http') return true;

    const decision = this.licensing.currentDecision();
    if (!decision) return true; // licenciamento desligado → fail-open

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const bypass = this.reflector.getAllAndOverride<boolean>(LICENSE_BYPASS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (bypass) return true;

    if (decision.effect === 'ALLOW' || decision.effect === 'GRACE') return true;

    // BLOCK_UI / BLOCK_UI_PROVISIONING → 402 Payment Required. O front trata o
    // 402 globalmente e leva pra tela de licença expirada.
    throw new HttpException(
      {
        type: 'urn:netx:error:license',
        title: 'Licença inativa',
        status: HttpStatus.PAYMENT_REQUIRED,
        detail: decision.reason,
        license: { effect: decision.effect, status: decision.status },
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}
