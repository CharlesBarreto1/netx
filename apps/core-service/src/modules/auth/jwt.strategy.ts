import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { AuthenticatedPrincipal } from '@netx/shared';
import { loadConfig } from '@netx/config';
import { ClsService } from 'nestjs-cls';

import type { AccessTokenPayload } from '@netx/auth';
import type { TenantClsStore } from '../../common/tenant-context';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(private readonly cls: ClsService<TenantClsStore>) {
    const cfg = loadConfig();
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: cfg.jwt.accessSecret,
      issuer: 'netx',
      audience: 'netx-api',
    });
  }

  async validate(payload: AccessTokenPayload): Promise<AuthenticatedPrincipal> {
    if (!payload.sub || !payload.tid) throw new UnauthorizedException('Invalid token');

    // Populate CLS with tenant context for downstream services
    this.cls.set('tenantId', payload.tid);
    this.cls.set('userId', payload.sub);

    return {
      sub: payload.sub,
      tenantId: payload.tid,
      email: (payload as unknown as { email?: string }).email ?? '',
      roles: payload.roles ?? [],
      permissions: payload.perms ?? [],
      mfaAuthenticated: Boolean(payload.mfa),
      sessionId: payload.sid,
    };
  }
}
