import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

export interface CreateRoleInput {
  tenantId: string;
  name: string;
  description?: string;
  priority?: number;
  permissionCodes: string[];
}

@Injectable()
export class RolesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string) {
    // Include system roles (tenantId IS NULL) + tenant-scoped roles
    const roles = await this.prisma.role.findMany({
      where: { OR: [{ tenantId: null }, { tenantId }] },
      include: { rolePermissions: { include: { permission: true } } },
      orderBy: { priority: 'asc' },
    });
    return roles.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      priority: r.priority,
      isSystem: r.isSystem,
      tenantId: r.tenantId,
      permissions: r.rolePermissions.map((rp) => rp.permission.code),
    }));
  }

  async create(input: CreateRoleInput) {
    const existing = await this.prisma.role.findUnique({
      where: { tenantId_name: { tenantId: input.tenantId, name: input.name } },
    });
    if (existing) throw new ConflictException('Role with this name already exists');

    const permissions = await this.prisma.permission.findMany({
      where: { code: { in: input.permissionCodes } },
    });
    if (permissions.length !== input.permissionCodes.length) {
      const found = new Set(permissions.map((p) => p.code));
      const missing = input.permissionCodes.filter((c) => !found.has(c));
      throw new BadRequestException(`Unknown permission codes: ${missing.join(', ')}`);
    }

    return this.prisma.role.create({
      data: {
        tenantId: input.tenantId,
        name: input.name,
        description: input.description,
        priority: input.priority ?? 100,
        isSystem: false,
        rolePermissions: {
          create: permissions.map((p) => ({ permissionId: p.id })),
        },
      },
    });
  }

  async delete(tenantId: string, id: string) {
    const role = await this.prisma.role.findFirst({ where: { id, tenantId } });
    if (!role) throw new NotFoundException('Role not found');
    if (role.isSystem) throw new BadRequestException('System roles cannot be deleted');
    await this.prisma.role.delete({ where: { id } });
  }

  async listPermissions() {
    return this.prisma.permission.findMany({ orderBy: [{ module: 'asc' }, { code: 'asc' }] });
  }
}
