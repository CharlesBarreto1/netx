import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service.js';
import { verifyPassword } from './password.util.js';
import type { Role } from '@prisma/client';
import type { Env } from '../config/env.js';
import type { AuthUser, CoreJwtClaims, JwtClaims } from './auth.types.js';

export interface LoginResult {
  token: string;
  user: AuthUser;
}

/**
 * Mapeia papéis/permissões do Core (RBAC do NetX) pro RBAC de 3 níveis do NMS.
 * Conservador: sobe pra operator/admin só com sinal explícito; o resto é viewer.
 */
function mapCoreRole(claims: CoreJwtClaims): Role {
  const roles = new Set((claims.roles ?? []).map((r) => r.toLowerCase()));
  const perms = new Set(claims.perms ?? []);
  if (roles.has('admin') || roles.has('owner') || perms.has('nms.admin')) return 'admin';
  if (roles.has('operator') || perms.has('nms.operate') || perms.has('nms.write')) {
    return 'operator';
  }
  return 'viewer';
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Valida usuário+senha e emite um JWT. Mensagem genérica para não vazar quais usuários existem. */
  async login(username: string, password: string): Promise<LoginResult> {
    const user = await this.prisma.user.findUnique({ where: { username } });
    // Verifica a senha mesmo quando o usuário não existe, para não vazar timing de existência.
    const stored = user?.passwordHash ?? 'scrypt:16384:8:1:AAAA:AAAA';
    const ok = await verifyPassword(password, stored);
    if (!user || !user.active || !ok) {
      throw new UnauthorizedException('Usuário ou senha inválidos');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const claims: JwtClaims = { sub: user.id, username: user.username, role: user.role };
    const token = await this.jwt.signAsync(claims);
    return { token, user: { id: user.id, username: user.username, role: user.role } };
  }

  /**
   * Verifica um token e devolve a identidade. Usado pelo guard HTTP e pela
   * ponte WS do terminal. Aceita DUAS origens (canal 1 — SSO):
   *   1. token nativo do NMS (assinado com JWT_SECRET) → revalida contra o banco;
   *   2. token de operador do Core (assinado com CORE_JWT_SECRET, se configurado)
   *      → identidade sintética `core:<sub>`, papel mapeado do RBAC do Core.
   */
  async verifyToken(token: string): Promise<AuthUser> {
    // 1. Token nativo do NMS.
    try {
      const claims = await this.jwt.verifyAsync<JwtClaims>(token);
      // Revalida contra o banco: conta desativada/removida perde acesso na hora.
      const user = await this.prisma.user.findUnique({ where: { id: claims.sub } });
      if (!user || !user.active) throw new UnauthorizedException('Conta inativa');
      return { id: user.id, username: user.username, role: user.role };
    } catch (err) {
      // Conta inativa é decisão final — não tenta o caminho do Core.
      if (err instanceof UnauthorizedException && err.message === 'Conta inativa') throw err;
      // Demais erros (assinatura/expiração) → pode ser um token do Core (SSO).
    }

    // 2. SSO do Core (opcional). Só quando CORE_JWT_SECRET está configurado.
    const coreSecret = this.config.get('CORE_JWT_SECRET', { infer: true });
    if (coreSecret) {
      try {
        const claims = await this.jwt.verifyAsync<CoreJwtClaims>(token, {
          secret: coreSecret,
          issuer: this.config.get('CORE_JWT_ISSUER', { infer: true }),
          audience: this.config.get('CORE_JWT_AUDIENCE', { infer: true }),
        });
        return {
          id: `core:${claims.sub}`,
          username: `core:${claims.sub}`,
          role: mapCoreRole(claims),
          external: true,
        };
      } catch {
        // cai no erro genérico abaixo
      }
    }

    throw new UnauthorizedException('Token inválido ou expirado');
  }
}
