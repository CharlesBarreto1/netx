/**
 * AuthService — login, MFA, refresh, token rotation, lockout.
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * @provenance MDg0NzI5Njg5MDE=
 */
import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { randomUUID, createHash } from 'crypto';
import { UserStatus } from '@prisma/client';

import {
  createJwtSigner,
  hashPassword,
  verifyPassword,
  type JwtSigner,
} from '@netx/auth';
import { loadConfig } from '@netx/config';
import type { LoginRequest, LoginResponse } from '@netx/shared';

import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MfaService } from './mfa.service';

@Injectable()
export class AuthService {
  private readonly config = loadConfig();
  private readonly jwt: JwtSigner = createJwtSigner({
    accessSecret: this.config.jwt.accessSecret,
    refreshSecret: this.config.jwt.refreshSecret,
    accessExpiresIn: this.config.jwt.accessExpiresIn,
    refreshExpiresIn: this.config.jwt.refreshExpiresIn,
  });

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(forwardRef(() => MfaService))
    private readonly mfa: MfaService,
  ) {}

  // ---------------------------------------------------------------------------
  // LOGIN
  // ---------------------------------------------------------------------------
  async login(input: LoginRequest, ip?: string, userAgent?: string): Promise<LoginResponse> {
    const tenantSlug = input.tenantSlug ?? this.config.tenancy.defaultTenantSlug;
    const tenant = await this.prisma.tenant.findUnique({ where: { slug: tenantSlug } });
    if (!tenant) {
      throw new UnauthorizedException({
        type: 'urn:netx:error:unauthorized',
        title: 'Invalid credentials',
      });
    }

    const user = await this.prisma.user.findUnique({
      where: { tenantId_email: { tenantId: tenant.id, email: input.email } },
      include: {
        userRoles: {
          include: {
            role: { include: { rolePermissions: { include: { permission: true } } } },
          },
        },
      },
    });

    // Generic error to avoid email enumeration
    if (!user || !user.passwordHash || user.status !== UserStatus.ACTIVE) {
      await this.audit.log({
        tenantId: tenant.id,
        action: 'auth.login.failed',
        level: 'WARNING',
        ip,
        userAgent,
        metadata: { email: input.email, reason: 'user_not_found_or_inactive' },
      });
      throw new UnauthorizedException({
        type: 'urn:netx:error:unauthorized',
        title: 'Invalid credentials',
      });
    }

    const passwordOk = await verifyPassword(user.passwordHash, input.password);
    if (!passwordOk) {
      await this.audit.log({
        tenantId: tenant.id,
        userId: user.id,
        action: 'auth.login.failed',
        level: 'WARNING',
        ip,
        userAgent,
        metadata: { reason: 'bad_password' },
      });
      throw new UnauthorizedException({
        type: 'urn:netx:error:unauthorized',
        title: 'Invalid credentials',
      });
    }

    // 2FA: se user tem MFA ativo, exige token válido (TOTP ou backup code).
    // Quando ausente, devolve 401 com type 'urn:netx:error:mfa-required' pra
    // o frontend saber que precisa pedir o token.
    if (user.mfaEnabled) {
      if (!input.mfaToken) {
        throw new UnauthorizedException({
          type: 'urn:netx:error:mfa-required',
          title: 'MFA required',
          detail: 'Informe o código do app autenticador.',
        });
      }
      const mfaOk = await this.mfa.verifyTokenOrBackup(user.id, input.mfaToken);
      if (!mfaOk) {
        throw new UnauthorizedException({
          type: 'urn:netx:error:mfa-invalid',
          title: 'Invalid MFA token',
          detail: 'Código inválido. Tente novamente.',
        });
      }
    }

    // Build access/refresh tokens
    const sessionId = randomUUID();
    const roles = user.userRoles.map((ur) => ur.role.name);
    const permissions = Array.from(
      new Set(
        user.userRoles.flatMap((ur) => ur.role.rolePermissions.map((rp) => rp.permission.code)),
      ),
    );

    const accessToken = this.jwt.signAccess({
      sub: user.id,
      tid: tenant.id,
      tsl: tenant.slug,
      roles,
      perms: permissions,
      sid: sessionId,
      mfa: user.mfaEnabled && Boolean(input.mfaToken),
    });

    const refreshJti = randomUUID();
    const refreshToken = this.jwt.signRefresh({
      sub: user.id,
      tid: tenant.id,
      sid: sessionId,
      jti: refreshJti,
    });

    await this.prisma.session.create({
      data: {
        id: sessionId,
        tenantId: tenant.id,
        userId: user.id,
        refreshTokenHash: createHash('sha256').update(refreshToken).digest('hex'),
        userAgent: userAgent ?? null,
        ip: ip ?? null,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), lastLoginIp: ip ?? null },
    });

    await this.audit.log({
      tenantId: tenant.id,
      userId: user.id,
      action: 'auth.login.success',
      ip,
      userAgent,
    });

    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: 900,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        roles,
        permissions,
        // menuAccess sai como Json — normaliza pra string[] | null pro frontend.
        menuAccess: Array.isArray(user.menuAccess)
          ? (user.menuAccess as unknown[]).filter(
              (x): x is string => typeof x === 'string',
            )
          : null,
        mustChangePassword: user.mustChangePassword,
      },
      tenant: {
        id: tenant.id,
        slug: tenant.slug,
        name: tenant.name,
        locale: tenant.locale,
        timezone: tenant.timezone,
        currency: tenant.currency,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // REFRESH
  // ---------------------------------------------------------------------------
  async refresh(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    let payload: { sub: string; tid: string; sid: string; jti: string };
    try {
      payload = this.jwt.verifyRefresh(refreshToken) as typeof payload;
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Detecção de reuso de refresh token (rotation hardening):
    //
    // Lookup pelo `sid` do payload (não pelo hash). Em rotação normal:
    //   - cliente apresenta o último refresh token → hash bate → rotate.
    //
    // Em ataque de reuso (token vazado E o cliente legítimo já fez refresh):
    //   - atacante apresenta token antigo válido (assinatura OK) → encontra
    //     session pelo `sid`, MAS o `refreshTokenHash` armazenado não bate
    //     (foi rotacionado quando o cliente legítimo refreshou).
    //   - Detectamos isso e revogamos a session INTEIRA — invalida tanto o
    //     atacante quanto o cliente legítimo (force-relogin é o preço de
    //     detectar o vazamento).
    //
    // Se `session.revokedAt` já está setado (logout ou reuso anterior), nem
    // tenta — só nega.
    const session = await this.prisma.session.findUnique({
      where: { id: payload.sid },
      include: {
        user: {
          include: {
            userRoles: {
              include: {
                role: { include: { rolePermissions: { include: { permission: true } } } },
              },
            },
          },
        },
        tenant: true,
      },
    });

    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Session expired or revoked');
    }

    const presentedHash = createHash('sha256').update(refreshToken).digest('hex');
    if (presentedHash !== session.refreshTokenHash) {
      // REUSE DETECTED — revoga session inteira e emite audit event.
      await this.prisma.session.update({
        where: { id: session.id },
        data: { revokedAt: new Date() },
      });
      // Audit é best-effort: se falha, ainda retornamos 401.
      try {
        await this.audit.log({
          tenantId: session.tenantId,
          userId: session.userId,
          action: 'AUTH_REFRESH_TOKEN_REUSE_DETECTED',
          resource: 'sessions',
          resourceId: session.id,
          level: 'WARNING',
          metadata: { sid: session.id },
        });
      } catch {
        /* swallow */
      }
      throw new UnauthorizedException('Session compromised — please re-authenticate');
    }

    const roles = session.user.userRoles.map((ur) => ur.role.name);
    const permissions = Array.from(
      new Set(
        session.user.userRoles.flatMap((ur) =>
          ur.role.rolePermissions.map((rp) => rp.permission.code),
        ),
      ),
    );

    const newAccess = this.jwt.signAccess({
      sub: session.userId,
      tid: session.tenantId,
      tsl: session.tenant.slug,
      roles,
      perms: permissions,
      sid: session.id,
      mfa: false,
    });

    // Rotate refresh token
    const newJti = randomUUID();
    const newRefresh = this.jwt.signRefresh({
      sub: session.userId,
      tid: session.tenantId,
      sid: session.id,
      jti: newJti,
    });
    const newHash = createHash('sha256').update(newRefresh).digest('hex');

    await this.prisma.session.update({
      where: { id: session.id },
      data: {
        refreshTokenHash: newHash,
        lastUsedAt: new Date(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    return { accessToken: newAccess, refreshToken: newRefresh };
  }

  // ---------------------------------------------------------------------------
  // LOGOUT
  // ---------------------------------------------------------------------------
  async logout(sessionId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  // ---------------------------------------------------------------------------
  // CHANGE PASSWORD
  // ---------------------------------------------------------------------------
  async changePassword(userId: string, current: string, next: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.passwordHash) throw new BadRequestException('Password auth not enabled');

    const ok = await verifyPassword(user.passwordHash, current);
    if (!ok) throw new UnauthorizedException('Current password is incorrect');

    const newHash = await hashPassword(next, this.config.argon2);
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: newHash,
        // Limpa flag de troca obrigatória — usuário acabou de definir sua
        // própria senha e o flow de /first-login está concluído.
        mustChangePassword: false,
      },
    });

    // Revoke all other sessions of this user
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await this.audit.log({
      tenantId: user.tenantId,
      userId,
      action: 'auth.password.changed',
    });
  }
}
