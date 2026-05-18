import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { AuthenticatedPrincipal } from '@netx/shared';
import { loadConfig } from '@netx/config';
import { ClsService } from 'nestjs-cls';

import type { AccessTokenPayload } from '@netx/auth';
import type { TenantClsStore } from '../../common/tenant-context';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    private readonly cls: ClsService<TenantClsStore>,
    private readonly prisma: PrismaService,
  ) {
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

    // Validação de sessão no DB: sem isso, um access token continua válido até
    // expirar mesmo após logout / disable / revogação. Com JWT_ACCESS_EXPIRES_IN
    // pequeno (15min) a janela é curta, mas a checagem ativa é decisiva pra
    // que logout invalide imediatamente e admin consiga "kick" um user comprometido.
    //
    // Performance: lookup indexado por sid (PK). ~1ms. Em volume alto, considerar
    // cache em Redis com TTL ~30s e invalidação no logout. Por ora, hit direto.
    if (!payload.sid) {
      throw new UnauthorizedException('Token sem session id');
    }
    const session = await this.prisma.session.findUnique({
      where: { id: payload.sid },
      select: { revokedAt: true, userId: true, tenantId: true, expiresAt: true },
    });
    if (!session) {
      throw new UnauthorizedException('Session not found');
    }
    if (session.revokedAt) {
      throw new UnauthorizedException('Session revoked');
    }
    // Defesa adicional: session expirada (Session.expiresAt < now) também é
    // bloqueada mesmo se o JWT ainda não expirou (clock skew, ou TTLs
    // descasados entre access/session).
    if (session.expiresAt && session.expiresAt < new Date()) {
      throw new UnauthorizedException('Session expired');
    }
    // Anti-tampering cruzado: sid existe mas pertence a outro user/tenant que
    // não os do token. Token deve ter sido reusado.
    if (session.userId !== payload.sub || session.tenantId !== payload.tid) {
      throw new UnauthorizedException('Session mismatch');
    }

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
