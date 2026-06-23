import {
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService } from './auth.service.js';
import { IS_PUBLIC_KEY } from './auth.decorators.js';
import type { AuthUser } from './auth.types.js';

/**
 * Guard global: exige `Authorization: Bearer <jwt>` em toda rota, exceto as marcadas com @Public().
 * Anexa o usuário verificado em `req.user` para os decorators e a auditoria (ADR 0007).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      user?: AuthUser;
    }>();
    const header = req.headers.authorization ?? '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('Credenciais ausentes');
    }
    req.user = await this.auth.verifyToken(token);
    return true;
  }
}
