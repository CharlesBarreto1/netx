import {
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@prisma/client';
import { ROLES_KEY } from './auth.decorators.js';
import type { AuthUser } from './auth.types.js';

/**
 * Guard global de RBAC: roda depois do JwtAuthGuard. Se o handler declara @Roles(...),
 * exige que o papel do usuário esteja na lista. Sem @Roles, qualquer autenticado passa.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    const user = req.user;
    if (!user || !required.includes(user.role)) {
      throw new ForbiddenException('Permissão insuficiente para esta ação');
    }
    return true;
  }
}
