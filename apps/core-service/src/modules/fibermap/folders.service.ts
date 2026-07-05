/**
 * FibermapFoldersService — árvore de pastas do FiberMap (spec §3.1, §6).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Diferente do NetworkFoldersService legado, aqui DELETE só é permitido em
 * pasta VAZIA (sem elementos, cabos ou sub-pastas) — spec §6. Elemento sempre
 * pertence a uma pasta (folder_id NOT NULL), então não há "liberar itens".
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  CreateFibermapFolderRequest,
  FibermapFolderResponse,
  UpdateFibermapFolderRequest,
} from '@netx/shared';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

type FolderRow = Prisma.FibermapFolderGetPayload<{
  include: { _count: { select: { elements: true; cables: true } } };
}>;

const FOLDER_INCLUDE = {
  _count: { select: { elements: true, cables: true } },
} satisfies Prisma.FibermapFolderInclude;

function toResponse(f: FolderRow): FibermapFolderResponse {
  return {
    id: f.id,
    parentId: f.parentId,
    name: f.name,
    sortOrder: f.sortOrder,
    elementsCount: f._count.elements,
    cablesCount: f._count.cables,
    createdAt: f.createdAt.toISOString(),
    updatedAt: f.updatedAt.toISOString(),
  };
}

@Injectable()
export class FibermapFoldersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Lista FLAT — a UI monta a árvore (mesma convenção do optical). */
  async list(tenantId: string): Promise<FibermapFolderResponse[]> {
    const rows = await this.prisma.fibermapFolder.findMany({
      where: { tenantId, deletedAt: null },
      include: FOLDER_INCLUDE,
      orderBy: [{ parentId: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    });
    return rows.map(toResponse);
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
    const parent = await this.prisma.fibermapFolder.findFirst({
      where: { id: parentId, tenantId, deletedAt: null },
      select: { id: true, parentId: true },
    });
    if (!parent) throw new BadRequestException('parentId inválido');
    // Anti-ciclo: sobe a cadeia de pais procurando selfId.
    if (selfId) {
      let cursor = parent.parentId;
      for (let depth = 0; cursor && depth < 32; depth++) {
        if (cursor === selfId) {
          throw new BadRequestException(
            'Movimento criaria ciclo na árvore de pastas',
          );
        }
        const up = await this.prisma.fibermapFolder.findFirst({
          where: { id: cursor, tenantId, deletedAt: null },
          select: { parentId: true },
        });
        cursor = up?.parentId ?? null;
      }
    }
  }

  async create(
    tenantId: string,
    actorUserId: string,
    input: CreateFibermapFolderRequest,
  ): Promise<FibermapFolderResponse> {
    await this.validateParent(tenantId, input.parentId);
    const created = await this.prisma.fibermapFolder.create({
      data: {
        tenantId,
        parentId: input.parentId ?? null,
        name: input.name.trim(),
        sortOrder: input.sortOrder,
        createdById: actorUserId,
      },
      include: FOLDER_INCLUDE,
    });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'fibermap.folder.created',
      resource: 'fibermap_folders',
      resourceId: created.id,
      afterState: { name: created.name, parentId: created.parentId },
    });
    return toResponse(created);
  }

  async update(
    tenantId: string,
    actorUserId: string,
    id: string,
    input: UpdateFibermapFolderRequest,
  ): Promise<FibermapFolderResponse> {
    const existing = await this.prisma.fibermapFolder.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Pasta não encontrada');
    if (input.parentId !== undefined) {
      await this.validateParent(tenantId, input.parentId, id);
    }
    const updated = await this.prisma.fibermapFolder.update({
      where: { id },
      data: {
        name: input.name?.trim(),
        parentId:
          input.parentId === undefined ? undefined : input.parentId ?? null,
        sortOrder: input.sortOrder,
        notes: input.notes === undefined ? undefined : input.notes ?? null,
      },
      include: FOLDER_INCLUDE,
    });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'fibermap.folder.updated',
      resource: 'fibermap_folders',
      resourceId: id,
    });
    return toResponse(updated);
  }

  /** DELETE só com pasta vazia (spec §6) — sem cascata implícita. */
  async remove(
    tenantId: string,
    actorUserId: string,
    id: string,
  ): Promise<void> {
    const existing = await this.prisma.fibermapFolder.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: {
        _count: {
          select: {
            elements: { where: { deletedAt: null } },
            cables: { where: { deletedAt: null } },
            children: { where: { deletedAt: null } },
          },
        },
      },
    });
    if (!existing) throw new NotFoundException('Pasta não encontrada');
    const { elements, cables, children } = existing._count;
    if (elements + cables + children > 0) {
      throw new ConflictException(
        `Pasta não está vazia (${elements} elementos, ${cables} cabos, ${children} sub-pastas) — mova ou exclua o conteúdo antes`,
      );
    }
    await this.prisma.fibermapFolder.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'fibermap.folder.deleted',
      resource: 'fibermap_folders',
      resourceId: id,
      beforeState: { name: existing.name },
    });
  }
}
