/**
 * FibermapCatalogService — catálogo de produtos (Tela 3, spec §3.2, §10).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Regras de negócio (spec §14.8):
 *  - Produto com instâncias em campo NUNCA é excluído — apenas desativado.
 *  - Edição NÃO propaga pra instâncias (elas guardam snapshot).
 *  - DELETE físico só sem instâncias; senão 409.
 * Modelos de cabo: estrutura imutável após criação (instâncias dependem dela
 * pros algoritmos); o que muda é criar outro modelo/duplicar.
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  buildTubeColors,
  type CreateFibermapCableModelRequest,
  type CreateFibermapProductRequest,
  type FibermapColorCode,
  type FibermapProductResponse,
  type ListFibermapProductsQuery,
  type UpdateFibermapProductRequest,
  paginationMeta,
  type Paginated,
} from '@netx/shared';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

type ProductRow = Prisma.FibermapProductGetPayload<{
  include: { cableModel: { include: { tubes: true } } };
}>;

const PRODUCT_INCLUDE = {
  cableModel: { include: { tubes: { orderBy: { tubeNumber: 'asc' } } } },
} satisfies Prisma.FibermapProductInclude;

function toResponse(
  p: ProductRow,
  instancesCount?: number,
): FibermapProductResponse {
  return {
    id: p.id,
    type: p.type,
    manufacturer: p.manufacturer,
    name: p.name,
    description: p.description,
    specs: (p.specs ?? {}) as Record<string, unknown>,
    isActive: p.isActive,
    instancesCount,
    cableModel: p.cableModel
      ? {
          fiberCount: p.cableModel.fiberCount,
          tubeCount: p.cableModel.tubeCount,
          fibersPerTube: p.cableModel.fibersPerTube,
          colorStandard: p.cableModel.colorStandard,
          tubeScheme: p.cableModel.tubeScheme,
          excessFactor: Number(p.cableModel.excessFactor),
          cableClass: p.cableModel.cableClass,
          tubes: p.cableModel.tubes.map((t) => ({
            tubeNumber: t.tubeNumber,
            color: t.color,
          })),
        }
      : null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

@Injectable()
export class FibermapCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ───────────────────────────────────────────────────────────────────────
  // Leitura
  // ───────────────────────────────────────────────────────────────────────
  async list(
    tenantId: string,
    q: ListFibermapProductsQuery,
  ): Promise<Paginated<FibermapProductResponse>> {
    const where: Prisma.FibermapProductWhereInput = {
      tenantId,
      deletedAt: null,
      ...(q.type ? { type: q.type } : {}),
      ...(q.active === undefined ? {} : { isActive: q.active }),
      ...(q.q
        ? {
            OR: [
              { name: { contains: q.q, mode: 'insensitive' } },
              { manufacturer: { contains: q.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.fibermapProduct.count({ where }),
      this.prisma.fibermapProduct.findMany({
        where,
        include: PRODUCT_INCLUDE,
        orderBy: [{ type: 'asc' }, { manufacturer: 'asc' }, { name: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    const counts = await this.instancesCountByProduct(
      tenantId,
      rows.map((r) => r.id),
    );
    return {
      data: rows.map((r) => toResponse(r, counts.get(r.id) ?? 0)),
      pagination: paginationMeta(total, q.page, q.pageSize),
    };
  }

  async findById(
    tenantId: string,
    id: string,
  ): Promise<FibermapProductResponse> {
    const p = await this.prisma.fibermapProduct.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: PRODUCT_INCLUDE,
    });
    if (!p) throw new NotFoundException('Produto não encontrado');
    const count = await this.instancesCount(tenantId, id);
    return toResponse(p, count);
  }

  /** Nº de instâncias em campo (elementos + cabos + devices vivos). */
  async instancesCount(tenantId: string, productId: string): Promise<number> {
    const [e, c, d] = await this.prisma.$transaction([
      this.prisma.fibermapElement.count({
        where: { tenantId, productId, deletedAt: null },
      }),
      this.prisma.fibermapCable.count({
        where: { tenantId, productId, deletedAt: null },
      }),
      this.prisma.fibermapDevice.count({
        where: { tenantId, productId, deletedAt: null },
      }),
    ]);
    return e + c + d;
  }

  private async instancesCountByProduct(
    tenantId: string,
    productIds: string[],
  ): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (productIds.length === 0) return out;
    const add = (rows: { productId: string | null; _count: number }[]) => {
      for (const r of rows) {
        if (!r.productId) continue;
        out.set(r.productId, (out.get(r.productId) ?? 0) + r._count);
      }
    };
    const [e, c, d] = await Promise.all([
      this.prisma.fibermapElement.groupBy({
        by: ['productId'],
        where: { tenantId, productId: { in: productIds }, deletedAt: null },
        _count: true,
      }),
      this.prisma.fibermapCable.groupBy({
        by: ['productId'],
        where: { tenantId, productId: { in: productIds }, deletedAt: null },
        _count: true,
      }),
      this.prisma.fibermapDevice.groupBy({
        by: ['productId'],
        where: { tenantId, productId: { in: productIds }, deletedAt: null },
        _count: true,
      }),
    ]);
    add(e);
    add(c);
    add(d);
    return out;
  }

  // ───────────────────────────────────────────────────────────────────────
  // Mutação — produtos (categorias não-cabo)
  // ───────────────────────────────────────────────────────────────────────
  async createProduct(
    tenantId: string,
    actorUserId: string,
    input: CreateFibermapProductRequest,
  ): Promise<FibermapProductResponse> {
    if (input.type === 'CABLE') {
      throw new BadRequestException(
        'Cabos são criados via POST /fibermap/catalog/cable-models (precisam da estrutura de tubos/fibras)',
      );
    }
    try {
      const created = await this.prisma.fibermapProduct.create({
        data: {
          tenantId,
          type: input.type,
          manufacturer: input.manufacturer.trim(),
          name: input.name.trim(),
          description: input.description ?? null,
          specs: (input.specs ?? {}) as Prisma.InputJsonValue,
          createdById: actorUserId,
        },
        include: PRODUCT_INCLUDE,
      });
      await this.audit.log({
        tenantId,
        userId: actorUserId,
        action: 'fibermap.product.created',
        resource: 'fibermap_products',
        resourceId: created.id,
        afterState: { type: created.type, name: created.name },
      });
      return toResponse(created, 0);
    } catch (err) {
      this.rethrowUnique(err);
    }
  }

  /** Cabo = produto + extensão estruturada + cores de tubo (uma transação). */
  async createCableModel(
    tenantId: string,
    actorUserId: string,
    input: CreateFibermapCableModelRequest,
  ): Promise<FibermapProductResponse> {
    // DTO já validou estrutura e customTubeColors; aqui só derivamos as cores.
    const tubeColors = buildTubeColors({
      scheme: input.tubeScheme,
      standard: input.colorStandard,
      tubeCount: input.tubeCount,
      customColors: input.customTubeColors as FibermapColorCode[] | undefined,
    });
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const product = await tx.fibermapProduct.create({
          data: {
            tenantId,
            type: 'CABLE',
            manufacturer: input.manufacturer.trim(),
            name: input.name.trim(),
            description: input.description ?? null,
            createdById: actorUserId,
          },
        });
        await tx.fibermapCableModel.create({
          data: {
            productId: product.id,
            tenantId,
            fiberCount: input.fiberCount,
            tubeCount: input.tubeCount,
            fibersPerTube: input.fibersPerTube,
            colorStandard: input.colorStandard,
            tubeScheme: input.tubeScheme,
            excessFactor: new Prisma.Decimal(input.excessFactor),
            cableClass: input.cableClass ?? null,
          },
        });
        await tx.fibermapCableModelTube.createMany({
          data: tubeColors.map((color, i) => ({
            cableModelId: product.id,
            tubeNumber: i + 1,
            color,
          })),
        });
        return product.id;
      });
      await this.audit.log({
        tenantId,
        userId: actorUserId,
        action: 'fibermap.cable_model.created',
        resource: 'fibermap_products',
        resourceId: created,
        afterState: {
          name: input.name,
          structure: `${input.tubeCount}×${input.fibersPerTube}`,
          colorStandard: input.colorStandard,
          tubeScheme: input.tubeScheme,
        },
      });
      return this.findById(tenantId, created);
    } catch (err) {
      this.rethrowUnique(err);
    }
  }

  /**
   * Edição não propaga (snapshot nas instâncias). Estrutura de modelo de cabo
   * é IMUTÁVEL — só metadados (nome/fabricante/descrição/specs) mudam.
   */
  async updateProduct(
    tenantId: string,
    actorUserId: string,
    id: string,
    input: UpdateFibermapProductRequest,
  ): Promise<FibermapProductResponse> {
    const existing = await this.prisma.fibermapProduct.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Produto não encontrado');
    try {
      await this.prisma.fibermapProduct.update({
        where: { id },
        data: {
          manufacturer: input.manufacturer?.trim(),
          name: input.name?.trim(),
          description:
            input.description === undefined
              ? undefined
              : input.description ?? null,
          specs:
            input.specs === undefined
              ? undefined
              : (input.specs as Prisma.InputJsonValue),
          updatedById: actorUserId,
        },
      });
    } catch (err) {
      this.rethrowUnique(err);
    }
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'fibermap.product.updated',
      resource: 'fibermap_products',
      resourceId: id,
    });
    return this.findById(tenantId, id);
  }

  /** Desativa (produtos com instâncias nunca são excluídos — spec §14.8). */
  async setActive(
    tenantId: string,
    actorUserId: string,
    id: string,
    isActive: boolean,
  ): Promise<FibermapProductResponse> {
    const existing = await this.prisma.fibermapProduct.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Produto não encontrado');
    await this.prisma.fibermapProduct.update({
      where: { id },
      data: { isActive, updatedById: actorUserId },
    });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: isActive
        ? 'fibermap.product.activated'
        : 'fibermap.product.deactivated',
      resource: 'fibermap_products',
      resourceId: id,
    });
    return this.findById(tenantId, id);
  }

  /** DELETE físico só sem instâncias; senão 409 (spec §6). */
  async remove(
    tenantId: string,
    actorUserId: string,
    id: string,
  ): Promise<void> {
    const existing = await this.prisma.fibermapProduct.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Produto não encontrado');
    const count = await this.instancesCount(tenantId, id);
    if (count > 0) {
      throw new ConflictException(
        `Produto tem ${count} instância(s) em campo — desative em vez de excluir`,
      );
    }
    // Sem instâncias: soft delete (histórico/auditoria preservados; o unique
    // composto segue o padrão do repo e bloqueia recriação com mesmo nome).
    await this.prisma.fibermapProduct.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false, updatedById: actorUserId },
    });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'fibermap.product.deleted',
      resource: 'fibermap_products',
      resourceId: id,
      beforeState: { type: existing.type, name: existing.name },
    });
  }

  private rethrowUnique(err: unknown): never {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      throw new ConflictException(
        'Já existe um produto com esse tipo/fabricante/nome',
      );
    }
    throw err;
  }
}
