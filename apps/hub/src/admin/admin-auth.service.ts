import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';

import { signAdminJwt } from '../common/jwt';
import { hashPassword, verifyPassword } from '../common/password';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AdminAuthService {
  constructor(private readonly prisma: PrismaService) {}

  async login(email: string, password: string): Promise<{ token: string; name: string | null }> {
    const admin = await this.prisma.hubAdmin.findUnique({ where: { email: email.toLowerCase() } });
    if (!admin || !admin.isActive || !verifyPassword(password, admin.passwordHash)) {
      throw new UnauthorizedException('e-mail ou senha inválidos');
    }
    await this.prisma.hubAdmin.update({
      where: { id: admin.id },
      data: { lastLoginAt: new Date() },
    });
    return {
      token: signAdminJwt({ sub: admin.id, email: admin.email, kind: 'admin' }),
      name: admin.name,
    };
  }

  async create(email: string, password: string, name?: string) {
    const e = email.toLowerCase();
    const dupe = await this.prisma.hubAdmin.findUnique({ where: { email: e } });
    if (dupe) throw new ConflictException('E-mail já cadastrado');
    const a = await this.prisma.hubAdmin.create({
      data: { email: e, name: name ?? null, passwordHash: hashPassword(password) },
    });
    return { id: a.id, email: a.email };
  }

  list() {
    return this.prisma.hubAdmin.findMany({
      orderBy: { createdAt: 'asc' },
      select: { id: true, email: true, name: true, isActive: true, lastLoginAt: true },
    });
  }
}
