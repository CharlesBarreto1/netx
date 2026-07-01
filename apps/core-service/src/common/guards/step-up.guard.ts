/**
 * StepUpGuard — exige que a sessão do chamador esteja ELEVADA (reautenticação
 * recente via POST /auth/step-up) para rotas marcadas com @RequireStepUp().
 *
 * Fonte da verdade = coluna Session.elevatedUntil (não o token — o claim mfa
 * decai no refresh). Faz um lookup direto da sessão só nas rotas gated (raras),
 * evitando tocar o caminho quente do JwtStrategy. Passthrough total quando a
 * rota não é marcada.
 */
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedPrincipal } from '@netx/shared';

import { STEP_UP_KEY } from '../decorators';
import { PrismaService } from '../../modules/prisma/prisma.service';

@Injectable()
export class StepUpGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<boolean>(STEP_UP_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user as AuthenticatedPrincipal | undefined;
    if (!user?.sessionId) {
      throw new ForbiddenException('Missing authenticated principal');
    }

    const session = await this.prisma.session.findUnique({
      where: { id: user.sessionId },
      select: { elevatedUntil: true },
    });
    if (!session?.elevatedUntil || session.elevatedUntil < new Date()) {
      throw new ForbiddenException({
        type: 'urn:netx:error:step-up-required',
        title: 'Reautenticação necessária',
        detail: 'Confirme sua identidade (senha ou MFA) para executar esta ação.',
        status: 403,
      });
    }
    return true;
  }
}
