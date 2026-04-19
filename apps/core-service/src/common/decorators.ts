import { SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthenticatedPrincipal } from '@netx/shared';

export const PERMISSIONS_KEY = 'permissions';
export const IS_PUBLIC_KEY = 'isPublic';

/** Marks a route as not requiring authentication. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Requires that the authenticated principal has ALL of the listed permissions.
 * Usage:  @RequirePermissions('users.create', 'users.read')
 */
export const RequirePermissions = (...perms: string[]) => SetMetadata(PERMISSIONS_KEY, perms);

/** Pull the authenticated principal from the request. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedPrincipal => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);

/** Pull the tenantId from the request context. */
export const TenantId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest();
  return request.tenantId ?? request.user?.tenantId;
});
