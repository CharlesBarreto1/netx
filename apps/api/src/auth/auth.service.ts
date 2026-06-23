import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service.js';
import { verifyPassword } from './password.util.js';
import type { AuthUser, JwtClaims } from './auth.types.js';

export interface LoginResult {
  token: string;
  user: AuthUser;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
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

  /** Verifica um token e devolve a identidade. Usado pelo guard HTTP e pela ponte WS do terminal. */
  async verifyToken(token: string): Promise<AuthUser> {
    let claims: JwtClaims;
    try {
      claims = await this.jwt.verifyAsync<JwtClaims>(token);
    } catch {
      throw new UnauthorizedException('Token inválido ou expirado');
    }
    // Revalida contra o banco: conta desativada/removida perde acesso na hora.
    const user = await this.prisma.user.findUnique({ where: { id: claims.sub } });
    if (!user || !user.active) throw new UnauthorizedException('Conta inativa');
    return { id: user.id, username: user.username, role: user.role };
  }
}
