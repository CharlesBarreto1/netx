import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ProductType } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

import type {
  CreateProductRequest,
  UpdateProductRequest,
} from '@netx/shared';

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    tenantId: string,
    query?: { search?: string; type?: ProductType; isActive?: boolean },
  ) {
    const where: Prisma.ProductWhereInput = {
      tenantId,
      deletedAt: null,
      ...(query?.type ? { type: query.type } : {}),
      ...(query?.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query?.search
        ? {
            OR: [
              { sku: { contains: query.search, mode: 'insensitive' } },
              { name: { contains: query.search, mode: 'insensitive' } },
              { brand: { contains: query.search, mode: 'insensitive' } },
              { model: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const products = await this.prisma.product.findMany({
      where,
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      take: 500,
    });

    // Enrich com totalStock — precisa de query agregada separada por tipo.
    return Promise.all(products.map((p) => this.enrichWithStock(p)));
  }

  async findById(tenantId: string, id: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!product) throw new NotFoundException('Produto não encontrado');
    return this.enrichWithStock(product);
  }

  /**
   * Adiciona campos `totalStock` e `totalAllocated` ao produto.
   *
   * Pra CONSUMIVEL: SUM(StockLevel.quantity) somando todos os locais.
   * Pra PATRIMONIAL: COUNT(SerialItem WHERE status='IN_STOCK') + ALLOCATED.
   *
   * Decimal é retornado como string pra preservar precisão.
   */
  private async enrichWithStock(product: { id: string; type: ProductType } & Record<string, unknown>) {
    if (product.type === 'CONSUMIVEL') {
      const agg = await this.prisma.stockLevel.aggregate({
        where: { productId: product.id },
        _sum: { quantity: true },
      });
      return {
        ...product,
        totalStock: agg._sum.quantity?.toString() ?? '0',
        totalAllocated: 0,
      };
    }
    // PATRIMONIAL
    const [inStock, allocated] = await Promise.all([
      this.prisma.serialItem.count({
        where: { productId: product.id, status: 'IN_STOCK' },
      }),
      this.prisma.serialItem.count({
        where: { productId: product.id, status: 'ALLOCATED' },
      }),
    ]);
    return { ...product, totalStock: String(inStock), totalAllocated: allocated };
  }

  async create(
    tenantId: string,
    actorUserId: string,
    input: CreateProductRequest,
  ) {
    // SKU duplicado?
    const existing = await this.prisma.product.findFirst({
      where: { tenantId, sku: input.sku, deletedAt: null },
    });
    if (existing) {
      throw new ConflictException(`Produto com SKU "${input.sku}" já existe`);
    }

    const product = await this.prisma.product.create({
      data: {
        tenantId,
        sku: input.sku,
        name: input.name,
        description: input.description ?? null,
        brand: input.brand ?? null,
        model: input.model ?? null,
        type: input.type,
        unit: input.unit,
        cost: 0, // custo médio começa em 0; recalcula na primeira compra
        price: input.price ?? null,
        minStock: input.minStock ?? null,
        isActive: input.isActive,
      },
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'product.created',
      resource: 'products',
      resourceId: product.id,
      afterState: { sku: product.sku, name: product.name, type: product.type },
    });

    return this.enrichWithStock(product);
  }

  async update(
    tenantId: string,
    actorUserId: string,
    id: string,
    input: UpdateProductRequest,
  ) {
    const before = await this.prisma.product.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!before) throw new NotFoundException('Produto não encontrado');

    // SKU duplicado?
    if (input.sku && input.sku !== before.sku) {
      const conflict = await this.prisma.product.findFirst({
        where: { tenantId, sku: input.sku, deletedAt: null, NOT: { id } },
      });
      if (conflict) {
        throw new ConflictException(`Outro produto já tem SKU "${input.sku}"`);
      }
    }

    const updated = await this.prisma.product.update({
      where: { id },
      data: {
        ...(input.sku !== undefined ? { sku: input.sku } : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.brand !== undefined ? { brand: input.brand } : {}),
        ...(input.model !== undefined ? { model: input.model } : {}),
        ...(input.unit !== undefined ? { unit: input.unit } : {}),
        ...(input.price !== undefined ? { price: input.price } : {}),
        ...(input.minStock !== undefined ? { minStock: input.minStock } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'product.updated',
      resource: 'products',
      resourceId: id,
      beforeState: { sku: before.sku, name: before.name, isActive: before.isActive },
      afterState: { sku: updated.sku, name: updated.name, isActive: updated.isActive },
    });

    return this.enrichWithStock(updated);
  }

  async remove(tenantId: string, actorUserId: string, id: string) {
    const before = await this.prisma.product.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!before) throw new NotFoundException('Produto não encontrado');

    // Bloqueia delete se tem saldo OU seriais associados.
    const [hasLevels, hasSerials] = await Promise.all([
      this.prisma.stockLevel.findFirst({ where: { productId: id } }),
      this.prisma.serialItem.findFirst({ where: { productId: id } }),
    ]);
    if (hasLevels || hasSerials) {
      throw new ConflictException(
        'Produto tem saldo ou seriais — desative ao invés de remover',
      );
    }

    await this.prisma.product.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'product.deleted',
      resource: 'products',
      resourceId: id,
      beforeState: { sku: before.sku, name: before.name },
    });
  }

  // Helper interno usado pelo PurchasesService: recalcula custo médio.
  // Fórmula: (qty_atual * cost_atual + qty_compra * cost_compra) / (qty_atual + qty_compra)
  //
  // Quantidade atual GLOBAL inclui:
  //   - CONSUMIVEL: SUM(StockLevel.quantity) em todos os locais
  //   - PATRIMONIAL: COUNT(SerialItem WHERE status IN ('IN_STOCK', 'ALLOCATED', 'IN_TRANSIT'))
  //     (DEFECTIVE/WRITTEN_OFF não contam — saíram da operação)
  //
  // Rodando dentro de transaction passada pelo caller.
  async recalcAverageCost(
    tx: Prisma.TransactionClient,
    productId: string,
    purchaseQty: number,
    purchaseUnitCost: number,
  ): Promise<void> {
    const product = await tx.product.findUnique({
      where: { id: productId },
      select: { id: true, type: true, cost: true },
    });
    if (!product) throw new BadRequestException('Produto não encontrado');

    let currentQty: number;
    if (product.type === 'CONSUMIVEL') {
      const agg = await tx.stockLevel.aggregate({
        where: { productId },
        _sum: { quantity: true },
      });
      currentQty = Number(agg._sum.quantity ?? 0);
    } else {
      currentQty = await tx.serialItem.count({
        where: {
          productId,
          status: { in: ['IN_STOCK', 'ALLOCATED', 'IN_TRANSIT'] },
        },
      });
    }

    const currentCost = Number(product.cost);
    const newQty = currentQty + purchaseQty;
    // Edge case: primeira compra (currentQty=0) → novo custo é o da compra.
    // Edge case: divisão por zero (não acontece com purchaseQty>0).
    const newAvg =
      newQty > 0
        ? (currentQty * currentCost + purchaseQty * purchaseUnitCost) / newQty
        : purchaseUnitCost;

    // Limita a 4 casas decimais pra bater com o schema.
    const rounded = Math.round(newAvg * 10000) / 10000;

    await tx.product.update({
      where: { id: productId },
      data: { cost: rounded },
    });
  }

  /**
   * Recomputa o custo médio ponderado do ZERO, via replay do kardex em ordem
   * cronológica. Usado após reverter/excluir uma compra (os movimentos dela já
   * foram removidos). Entradas com custo recalculam a média; saídas só reduzem
   * o saldo (não mexem no custo); transferências/comodato são neutras (não
   * mudam o total nem o custo). Sem estoque restante → custo volta a 0.
   */
  async recomputeAverageCost(
    tx: Prisma.TransactionClient,
    productId: string,
  ): Promise<void> {
    const movements = await tx.stockMovement.findMany({
      where: { productId },
      orderBy: { createdAt: 'asc' },
      select: { type: true, quantity: true, unitCost: true },
    });
    const INBOUND = new Set(['PURCHASE', 'ADJUSTMENT_IN', 'SALE_RETURN']);
    const OUTBOUND = new Set([
      'PURCHASE_RETURN',
      'SALE',
      'OS_CONSUMPTION',
      'ADJUSTMENT_OUT',
    ]);
    let qty = 0;
    let avg = 0;
    for (const m of movements) {
      const q = Number(m.quantity);
      const c = Number(m.unitCost);
      if (INBOUND.has(m.type)) {
        const nq = qty + q;
        avg = nq > 0 ? (qty * avg + q * c) / nq : avg;
        qty = nq;
      } else if (OUTBOUND.has(m.type)) {
        qty = Math.max(0, qty - q);
        // saída não muda o custo médio
      }
      // TRANSFER_IN/OUT e COMODATO_OUT/RETURN: neutros pro custo global
    }
    await tx.product.update({
      where: { id: productId },
      data: { cost: Math.round(avg * 10000) / 10000 },
    });
  }
}
