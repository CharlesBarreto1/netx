import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedPrincipal } from '@netx/shared';

import { PERMISSIONS_KEY } from '../decorators';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user as AuthenticatedPrincipal | undefined;
    if (!user) throw new ForbiddenException('Missing authenticated principal');

    const granted = new Set(user.permissions);
    const missing = required.filter((p) => !granted.has(p));
    if (missing.length > 0) {
      throw new ForbiddenException({
        type: 'urn:netx:error:forbidden',
        title: 'Insufficient permissions',
        detail: `Missing: ${missing.join(', ')}`,
      });
    }
    return true;
  }
}
