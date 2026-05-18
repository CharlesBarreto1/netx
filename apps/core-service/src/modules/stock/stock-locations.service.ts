import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

import type {
  CreateStockLocationRequest,
  SetLocationAccessRequest,
  UpdateStockLocationRequest,
} from '@netx/shared';

/**
 * StockLocationsService — gerencia almoxarifados + ACL por usuário.
 *
 * Modelo de acesso:
 *   - Lista padrão (`listForUser`) filtra por `stock_location_users` do user.
 *   - Roles com permissão `stock.admin` ou `*` bypassam o filtro (`listAll`).
 *   - Acesso de WRITE checado em `assertCanWrite` antes de operações que
 *     mexem em saldo (purchases, transfers, adjustments).
 */
@Injectable()
export class StockLocationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // Listagem completa (admin). Inclui userAccess + stats.
  async listAll(tenantId: string) {
    const locations = await this.prisma.stockLocation.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      include: {
        userAccess: { include: { user: { select: { firstName: true, lastName: true, email: true } } } },
      },
    });
    return Promise.all(locations.map((l) => this.enrichWithStats(l)));
  }

  // Listagem filtrada pelo acesso do usuário. Usado em selects de UI
  // (compra, transferência) onde operador só pode escolher locais que opera.
  async listForUser(tenantId: string, userId: string) {
    const locations = await this.prisma.stockLocation.findMany({
      where: {
        tenantId,
        deletedAt: null,
        isActive: true,
        userAccess: { some: { userId } },
      },
      orderBy: [{ name: 'asc' }],
    });
    return locations;
  }

  async findById(tenantId: string, id: string) {
    const location = await this.prisma.stockLocation.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: {
        userAccess: { include: { user: { select: { firstName: true, lastName: true, email: true } } } },
      },
    });
    if (!location) throw new NotFoundException('Local não encontrado');
    return this.enrichWithStats(location);
  }

  private async enrichWithStats(
    location: Prisma.StockLocationGetPayload<{ include: { userAccess: { include: { user: true } } } }> | Prisma.StockLocationGetPayload<object>,
  ) {
    const [consumableProducts, serialItemsInStock] = await Promise.all([
      this.prisma.stockLevel.count({
        where: { locationId: location.id, quantity: { gt: 0 } },
      }),
      this.prisma.serialItem.count({
        where: { locationId: location.id, status: 'IN_STOCK' },
      }),
    ]);
    return {
      ...location,
      stats: { consumableProducts, serialItemsInStock },
    };
  }

  async create(
    tenantId: string,
    actorUserId: string,
    input: CreateStockLocationRequest,
  ) {
    const existing = await this.prisma.stockLocation.findFirst({
      where: { tenantId, code: input.code, deletedAt: null },
    });
    if (existing) {
      throw new ConflictException(`Local com code "${input.code}" já existe`);
    }

    // Valida que userIds existem no tenant (se algum foi passado).
    if (input.userIds.length > 0) {
      const found = await this.prisma.user.count({
        where: { tenantId, id: { in: input.userIds } },
      });
      if (found !== input.userIds.length) {
        throw new BadRequestException('Algum userId não pertence ao tenant');
      }
    }

    const location = await this.prisma.stockLocation.create({
      data: {
        tenantId,
        code: input.code,
        name: input.name,
        address: input.address ?? null,
        isActive: input.isActive,
        userAccess: {
          create: input.userIds.map((userId) => ({
            userId,
            canWrite: true,
          })),
        },
      },
      include: { userAccess: true },
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'stock_location.created',
      resource: 'stock_locations',
      resourceId: location.id,
      afterState: { code: location.code, name: location.name },
    });

    return this.enrichWithStats(location);
  }

  async update(
    tenantId: string,
    actorUserId: string,
    id: string,
    input: UpdateStockLocationRequest,
  ) {
    const before = await this.prisma.stockLocation.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!before) throw new NotFoundException('Local não encontrado');

    if (input.code && input.code !== before.code) {
      const conflict = await this.prisma.stockLocation.findFirst({
        where: { tenantId, code: input.code, deletedAt: null, NOT: { id } },
      });
      if (conflict) {
        throw new ConflictException(`Outro local já tem code "${input.code}"`);
      }
    }

    const updated = await this.prisma.stockLocation.update({
      where: { id },
      data: {
        ...(input.code !== undefined ? { code: input.code } : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.address !== undefined ? { address: input.address } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });

    // userIds via update é destrutivo: substitui ACL inteira. Se não veio,
    // não toca. Pra delta granular use `setAccess`.
    if (input.userIds !== undefined) {
      await this.setAccess(tenantId, actorUserId, id, {
        userIds: input.userIds.map((userId) => ({ userId, canWrite: true })),
      });
    }

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'stock_location.updated',
      resource: 'stock_locations',
      resourceId: id,
      beforeState: { code: before.code, name: before.name, isActive: before.isActive },
      afterState: { code: updated.code, name: updated.name, isActive: updated.isActive },
    });

    return this.findById(tenantId, id);
  }

  async remove(tenantId: string, actorUserId: string, id: string) {
    const before = await this.prisma.stockLocation.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!before) throw new NotFoundException('Local não encontrado');

    // Bloqueia se tem saldo > 0 ou seriais alocados.
    const [hasLevels, hasSerials] = await Promise.all([
      this.prisma.stockLevel.findFirst({
        where: { locationId: id, quantity: { gt: 0 } },
      }),
      this.prisma.serialItem.findFirst({
        where: { locationId: id, status: { in: ['IN_STOCK', 'IN_TRANSIT'] } },
      }),
    ]);
    if (hasLevels || hasSerials) {
      throw new ConflictException(
        'Local tem saldo ou equipamentos — transfira antes de remover',
      );
    }

    await this.prisma.stockLocation.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'stock_location.deleted',
      resource: 'stock_locations',
      resourceId: id,
      beforeState: { code: before.code, name: before.name },
    });
  }

  // Substitui inteira a ACL do local — operação atômica em transação.
  async setAccess(
    tenantId: string,
    actorUserId: string,
    locationId: string,
    input: SetLocationAccessRequest,
  ) {
    const location = await this.findById(tenantId, locationId);

    // Valida users
    if (input.userIds.length > 0) {
      const userIds = input.userIds.map((u) => u.userId);
      const found = await this.prisma.user.count({
        where: { tenantId, id: { in: userIds } },
      });
      if (found !== userIds.length) {
        throw new BadRequestException('Algum userId não pertence ao tenant');
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.stockLocationUser.deleteMany({ where: { locationId } });
      if (input.userIds.length > 0) {
        await tx.stockLocationUser.createMany({
          data: input.userIds.map((u) => ({
            locationId,
            userId: u.userId,
            canWrite: u.canWrite,
          })),
        });
      }
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'stock_location.access_set',
      resource: 'stock_locations',
      resourceId: locationId,
      afterState: { count: input.userIds.length },
    });

    return this.findById(tenantId, locationId);
  }

  // Verifica se userId tem WRITE no locationId. Chamado por purchases/transfers/adjustments.
  // Roles com permissão `stock.admin` chegam via guard separado e bypassam isto.
  async assertCanWrite(tenantId: string, userId: string, locationId: string) {
    const access = await this.prisma.stockLocationUser.findFirst({
      where: {
        locationId,
        userId,
        canWrite: true,
        location: { tenantId, deletedAt: null, isActive: true },
      },
    });
    if (!access) {
      throw new ForbiddenException(
        'Usuário não tem permissão de write neste local',
      );
    }
  }
}
