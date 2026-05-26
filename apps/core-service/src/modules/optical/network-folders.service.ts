/**
 * NetworkFoldersService — pastas administrativas da planta (R4.5e).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Doc: docs/architecture/osp-network.md
 *
 * CRUD + atribuição batch de itens. Hierarquia (parentId) é gerenciada
 * via PATCH normal. UI faz tree do flat list — não retornamos nested.
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  AssignItemsToFolderRequest,
  CreateNetworkFolderRequest,
  NetworkFolderResponse,
  UpdateNetworkFolderRequest,
} from '@netx/shared';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

type FolderRow = Prisma.NetworkFolderGetPayload<{
  include: {
    _count: { select: { enclosures: true; cables: true } };
  };
}>;

function toResponse(f: FolderRow): NetworkFolderResponse {
  return {
    id: f.id,
    tenantId: f.tenantId,
    parentId: f.parentId,
    name: f.name,
    color: f.color,
    position: f.position,
    notes: f.notes,
    createdAt: f.createdAt.toISOString(),
    updatedAt: f.updatedAt.toISOString(),
    itemCounts: {
      enclosures: f._count.enclosures,
      cables: f._count.cables,
    },
  };
}

const FOLDER_INCLUDE = {
  _count: { select: { enclosures: true, cables: true } },
} satisfies Prisma.NetworkFolderInclude;

@Injectable()
export class NetworkFoldersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(tenantId: string): Promise<NetworkFolderResponse[]> {
    const rows = await this.prisma.networkFolder.findMany({
      where: { tenantId, deletedAt: null },
      include: FOLDER_INCLUDE,
      orderBy: [{ parentId: 'asc' }, { position: 'asc' }, { name: 'asc' }],
    });
    return rows.map(toResponse);
  }

  async findById(
    tenantId: string,
    id: string,
  ): Promise<NetworkFolderResponse> {
    const f = await this.prisma.networkFolder.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: FOLDER_INCLUDE,
    });
    if (!f) throw new NotFoundException('Pasta não encontrada');
    return toResponse(f);
  }

  private async validateParent(
    tenantId: string,
    parentId: string | null | undefined,
    selfId?: string,
  ): Promise<void> {
    if (!parentId) return;
    if (parentId === selfId) {
      throw new BadRequestException('Pasta não pode ser pai de si mesma');
    }
    const parent = await this.prisma.networkFolder.findFirst({
      where: { id: parentId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!parent) throw new BadRequestException('parentId inválido');
  }

  async create(
    tenantId: string,
    actorUserId: string,
    input: CreateNetworkFolderRequest,
  ): Promise<NetworkFolderResponse> {
    await this.validateParent(tenantId, input.parentId);

    // position default = max+1 dos irmãos
    const position =
      input.position ??
      ((
        await this.prisma.networkFolder.aggregate({
          where: {
            tenantId,
            parentId: input.parentId ?? null,
            deletedAt: null,
          },
          _max: { position: true },
        })
      )._max.position ?? 0) + 10;

    try {
      const created = await this.prisma.networkFolder.create({
        data: {
          tenantId,
          parentId: input.parentId ?? null,
          name: input.name.trim(),
          color: input.color ?? null,
          position,
          notes: input.notes ?? null,
          createdById: actorUserId,
        },
        include: FOLDER_INCLUDE,
      });
      await this.audit.log({
        tenantId,
        userId: actorUserId,
        action: 'network.folder.created',
        resource: 'network_folders',
        resourceId: created.id,
        afterState: { name: created.name, parentId: created.parentId },
      });
      return toResponse(created);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException('Pasta com esse nome já existe');
      }
      throw err;
    }
  }

  async update(
    tenantId: string,
    actorUserId: string,
    id: string,
    input: UpdateNetworkFolderRequest,
  ): Promise<NetworkFolderResponse> {
    const existing = await this.prisma.networkFolder.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Pasta não encontrada');

    if (input.parentId !== undefined) {
      await this.validateParent(tenantId, input.parentId, id);
    }

    const updated = await this.prisma.networkFolder.update({
      where: { id },
      data: {
        parentId:
          input.parentId === undefined ? undefined : input.parentId ?? null,
        name: input.name?.trim(),
        color: input.color === undefined ? undefined : input.color ?? null,
        position: input.position,
        notes: input.notes === undefined ? undefined : input.notes ?? null,
      },
      include: FOLDER_INCLUDE,
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'network.folder.updated',
      resource: 'network_folders',
      resourceId: id,
    });

    return toResponse(updated);
  }

  async remove(
    tenantId: string,
    actorUserId: string,
    id: string,
  ): Promise<void> {
    const existing = await this.prisma.networkFolder.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: FOLDER_INCLUDE,
    });
    if (!existing) throw new NotFoundException('Pasta não encontrada');

    // Soft delete + libera items (folderId vira null via FK ON DELETE SET NULL).
    // Prisma soft-delete não dispara o trigger; precisamos limpar manualmente.
    await this.prisma.$transaction([
      this.prisma.opticalEnclosure.updateMany({
        where: { tenantId, folderId: id, deletedAt: null },
        data: { folderId: null },
      }),
      this.prisma.fiberCable.updateMany({
        where: { tenantId, folderId: id, deletedAt: null },
        data: { folderId: null },
      }),
      // Sub-pastas viram raízes (parentId null).
      this.prisma.networkFolder.updateMany({
        where: { tenantId, parentId: id, deletedAt: null },
        data: { parentId: null },
      }),
      this.prisma.networkFolder.update({
        where: { id },
        data: { deletedAt: new Date() },
      }),
    ]);

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'network.folder.deleted',
      resource: 'network_folders',
      resourceId: id,
    });
  }

  /**
   * Atribui múltiplos items a uma pasta (ou desatribui se folderId for null).
   * Update batch — operador no mapa seleciona itens e move pra pasta com 1 ação.
   */
  async assignItems(
    tenantId: string,
    actorUserId: string,
    folderId: string | null,
    input: AssignItemsToFolderRequest,
  ): Promise<{ enclosuresUpdated: number; cablesUpdated: number }> {
    if (folderId) {
      const folder = await this.prisma.networkFolder.findFirst({
        where: { id: folderId, tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!folder) throw new BadRequestException('folderId inválido');
    }

    const [enclosuresUpdated, cablesUpdated] = await this.prisma.$transaction([
      this.prisma.opticalEnclosure.updateMany({
        where: {
          tenantId,
          id: { in: input.enclosureIds },
          deletedAt: null,
        },
        data: { folderId, updatedById: actorUserId },
      }),
      this.prisma.fiberCable.updateMany({
        where: {
          tenantId,
          id: { in: input.cableIds },
          deletedAt: null,
        },
        data: { folderId, updatedById: actorUserId },
      }),
    ]);

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'network.folder.items.assigned',
      resource: 'network_folders',
      resourceId: folderId ?? undefined,
      afterState: {
        enclosuresUpdated: enclosuresUpdated.count,
        cablesUpdated: cablesUpdated.count,
      },
    });

    return {
      enclosuresUpdated: enclosuresUpdated.count,
      cablesUpdated: cablesUpdated.count,
    };
  }
}
