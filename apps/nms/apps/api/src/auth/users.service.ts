import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { Prisma, type Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { hashPassword } from './password.util.js';
import type { Env } from '../config/env.js';
import type { CreateUserDto, UpdateUserDto } from './users.dto.js';

/** View pública de um usuário — NUNCA inclui o hash da senha. */
export interface UserView {
  id: string;
  username: string;
  name: string | null;
  role: Role;
  active: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
}

const PUBLIC_SELECT = {
  id: true,
  username: true,
  name: true,
  role: true,
  active: true,
  lastLoginAt: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersService implements OnModuleInit {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Seed do 1º admin: só roda quando NÃO existe nenhum usuário (idempotente). */
  async onModuleInit(): Promise<void> {
    const count = await this.prisma.user.count();
    if (count > 0) return;

    const username = this.config.get('ADMIN_USERNAME', { infer: true });
    const provided = this.config.get('ADMIN_PASSWORD', { infer: true });
    const password = provided ?? randomBytes(12).toString('base64url');

    await this.prisma.user.create({
      data: { username, passwordHash: await hashPassword(password), role: 'admin' },
    });

    if (provided) {
      this.logger.log(`Admin inicial "${username}" criado a partir de ADMIN_PASSWORD.`);
    } else {
      this.logger.warn(
        `Admin inicial criado. GUARDE ESTA SENHA (mostrada só uma vez):\n` +
          `    usuário: ${username}\n` +
          `    senha:   ${password}`,
      );
    }
  }

  list(): Promise<UserView[]> {
    return this.prisma.user.findMany({
      select: PUBLIC_SELECT,
      orderBy: { createdAt: 'asc' },
    });
  }

  async create(dto: CreateUserDto): Promise<UserView> {
    try {
      return await this.prisma.user.create({
        data: {
          username: dto.username,
          name: dto.name ?? null,
          role: dto.role,
          passwordHash: await hashPassword(dto.password),
        },
        select: PUBLIC_SELECT,
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Já existe um usuário com este nome');
      }
      throw e;
    }
  }

  async update(id: string, dto: UpdateUserDto): Promise<UserView> {
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('Usuário não encontrado');

    // Trava de segurança: não deixar o sistema sem nenhum admin ativo.
    const losingAdmin =
      target.role === 'admin' &&
      target.active &&
      ((dto.role !== undefined && dto.role !== 'admin') || dto.active === false);
    if (losingAdmin) await this.assertNotLastAdmin(id);

    const data: Prisma.UserUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.role !== undefined) data.role = dto.role;
    if (dto.active !== undefined) data.active = dto.active;
    if (dto.password !== undefined) data.passwordHash = await hashPassword(dto.password);

    return this.prisma.user.update({ where: { id }, data, select: PUBLIC_SELECT });
  }

  async remove(id: string): Promise<void> {
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('Usuário não encontrado');
    if (target.role === 'admin' && target.active) await this.assertNotLastAdmin(id);
    await this.prisma.user.delete({ where: { id } });
  }

  private async assertNotLastAdmin(excludeId: string): Promise<void> {
    const others = await this.prisma.user.count({
      where: { role: 'admin', active: true, id: { not: excludeId } },
    });
    if (others === 0) {
      throw new BadRequestException('Não é possível remover/rebaixar o último admin ativo');
    }
  }
}
