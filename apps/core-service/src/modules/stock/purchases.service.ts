import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

import { ProductsService } from './products.service';
import { StockLocationsService } from './stock-locations.service';

import type { CreatePurchaseRequest } from '@netx/shared';

/**
 * PurchasesService — registra entrada de mercadoria por compra.
 *
 * Operação atômica em uma transação Prisma:
 *   1. Cria Purchase + N PurchaseItems
 *   2. Pra cada item:
 *      a. Valida que o user tem WRITE no locationId
 *      b. Valida tipo: PATRIMONIAL exige serials.length === quantity; CONSUMIVEL exige serials vazio
 *      c. Cria N SerialItems (PATRIMONIAL) OU upsert StockLevel (CONSUMIVEL)
 *      d. Recalcula Product.cost (custo médio ponderado)
 *      e. Cria 1 StockMovement por unidade (PATRIMONIAL) OU 1 por item (CONSUMIVEL)
 *
 * Falha em qualquer passo → rollback completo (transaction). Sem estado parcial.
 */
@Injectable()
export class PurchasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly products: ProductsService,
    private readonly locations: StockLocationsService,
  ) {}

  async list(
    tenantId: string,
    query?: { supplierId?: string; dateFrom?: string; dateTo?: string },
  ) {
    return this.prisma.purchase.findMany({
      where: {
        tenantId,
        ...(query?.supplierId ? { supplierId: query.supplierId } : {}),
        ...(query?.dateFrom || query?.dateTo
          ? {
              date: {
                ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
                ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
              },
            }
          : {}),
      },
      orderBy: { date: 'desc' },
      include: {
        supplier: { select: { id: true, name: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        items: {
          include: {
            product: { select: { id: true, sku: true, name: true, type: true } },
            location: { select: { id: true, code: true, name: true } },
          },
        },
      },
      take: 200,
    });
  }

  async findById(tenantId: string, id: string) {
    const purchase = await this.prisma.purchase.findFirst({
      where: { id, tenantId },
      include: {
        supplier: true,
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        items: {
          include: {
            product: { select: { id: true, sku: true, name: true, type: true } },
            location: { select: { id: true, code: true, name: true } },
          },
        },
      },
    });
    if (!purchase) throw new NotFoundException('Compra não encontrada');
    return purchase;
  }

  async create(
    tenantId: string,
    actorUserId: string,
    input: CreatePurchaseRequest,
  ) {
    // ──────────────────────────────────────────────────────────────────────
    // VALIDAÇÕES PRÉVIAS — falhar rápido ANTES de abrir transação, pra que
    // erros 4xx típicos (Zod / not found / forbidden) não consumam locks
    // de transaction desnecessariamente.
    // ──────────────────────────────────────────────────────────────────────

    // 1. Supplier existe e pertence ao tenant
    const supplier = await this.prisma.supplier.findFirst({
      where: { id: input.supplierId, tenantId, deletedAt: null },
    });
    if (!supplier) throw new NotFoundException('Fornecedor não encontrado');

    // 2. Carrega todos os produtos referenciados (1 query)
    const productIds = Array.from(new Set(input.items.map((i) => i.productId)));
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, tenantId, deletedAt: null, isActive: true },
    });
    if (products.length !== productIds.length) {
      throw new BadRequestException(
        'Algum produto não encontrado ou inativo',
      );
    }
    const productById = new Map(products.map((p) => [p.id, p]));

    // 3. Carrega todos os locais (1 query)
    const locationIds = Array.from(new Set(input.items.map((i) => i.locationId)));
    const locations = await this.prisma.stockLocation.findMany({
      where: {
        id: { in: locationIds },
        tenantId,
        deletedAt: null,
        isActive: true,
      },
    });
    if (locations.length !== locationIds.length) {
      throw new BadRequestException('Algum local não encontrado ou inativo');
    }

    // 4. Verifica ACL de write pro user em cada local distinto
    for (const locationId of locationIds) {
      await this.locations.assertCanWrite(tenantId, actorUserId, locationId);
    }

    // 5. Validações por item: tipo, serials
    for (const item of input.items) {
      const product = productById.get(item.productId)!;
      if (product.type === 'PATRIMONIAL') {
        if (item.serials.length !== Math.floor(item.quantity)) {
          throw new BadRequestException(
            `Produto ${product.sku} é PATRIMONIAL — passe ${item.quantity} serial(s), recebeu ${item.serials.length}`,
          );
        }
        // quantity deve ser inteiro pra patrimonial
        if (!Number.isInteger(item.quantity)) {
          throw new BadRequestException(
            `Produto ${product.sku} é PATRIMONIAL — quantidade precisa ser inteira`,
          );
        }
        // serials únicos dentro do payload
        const set = new Set(item.serials.map((s) => s.trim()));
        if (set.size !== item.serials.length) {
          throw new BadRequestException(
            `Produto ${product.sku}: serials duplicados no payload`,
          );
        }
        // serials já existentes no DB
        const existing = await this.prisma.serialItem.findMany({
          where: {
            tenantId,
            productId: product.id,
            serial: { in: Array.from(set) },
          },
          select: { serial: true },
        });
        if (existing.length > 0) {
          throw new ConflictException(
            `Produto ${product.sku}: serial(is) já cadastrado(s): ${existing.map((e) => e.serial).join(', ')}`,
          );
        }
      } else {
        // CONSUMIVEL
        if (item.serials.length > 0) {
          throw new BadRequestException(
            `Produto ${product.sku} é CONSUMIVEL — serials não devem ser passados`,
          );
        }
      }
    }

    // 6. invoice number único por (supplier, tenant)
    if (input.invoiceNumber) {
      const conflict = await this.prisma.purchase.findFirst({
        where: {
          tenantId,
          supplierId: input.supplierId,
          invoiceNumber: input.invoiceNumber,
        },
      });
      if (conflict) {
        throw new ConflictException(
          `Compra com NF ${input.invoiceNumber} desse fornecedor já existe`,
        );
      }
    }

    const totalCost = input.items.reduce(
      (acc, i) => acc + i.quantity * i.unitCost,
      0,
    );

    // ──────────────────────────────────────────────────────────────────────
    // TRANSAÇÃO ATÔMICA
    // ──────────────────────────────────────────────────────────────────────
    const purchase = await this.prisma.$transaction(async (tx) => {
      // a. Cria header
      const created = await tx.purchase.create({
        data: {
          tenantId,
          supplierId: input.supplierId,
          invoiceNumber: input.invoiceNumber ?? null,
          date: new Date(input.date),
          totalCost: Math.round(totalCost * 10000) / 10000,
          notes: input.notes ?? null,
          createdById: actorUserId,
        },
      });

      // b. Pra cada item
      for (const item of input.items) {
        const product = productById.get(item.productId)!;
        const itemTotal = Math.round(item.quantity * item.unitCost * 10000) / 10000;

        const purchaseItem = await tx.purchaseItem.create({
          data: {
            tenantId,
            purchaseId: created.id,
            productId: product.id,
            locationId: item.locationId,
            quantity: item.quantity,
            unitCost: item.unitCost,
            totalCost: itemTotal,
            serials: item.serials,
            notes: item.notes ?? null,
          },
        });

        // c.1. Recalcula custo médio do produto ANTES de atualizar
        //      saldo — usa a quantidade ANTERIOR ao incremento.
        await this.products.recalcAverageCost(
          tx,
          product.id,
          item.quantity,
          item.unitCost,
        );

        if (product.type === 'PATRIMONIAL') {
          // c.2.a. Cria N SerialItems
          await tx.serialItem.createMany({
            data: item.serials.map((serial) => ({
              tenantId,
              productId: product.id,
              serial: serial.trim(),
              status: 'IN_STOCK' as const,
              locationId: item.locationId,
              acquisitionCost: item.unitCost,
              acquisitionDate: new Date(input.date),
            })),
          });

          // c.3.a. Cria 1 StockMovement por unidade — kardex granular por serial
          const createdSerials = await tx.serialItem.findMany({
            where: {
              tenantId,
              productId: product.id,
              serial: { in: item.serials.map((s) => s.trim()) },
            },
            select: { id: true },
          });
          await tx.stockMovement.createMany({
            data: createdSerials.map((s) => ({
              tenantId,
              type: 'PURCHASE' as const,
              productId: product.id,
              serialItemId: s.id,
              fromLocationId: null,
              toLocationId: item.locationId,
              quantity: 1,
              unitCost: item.unitCost,
              totalCost: item.unitCost,
              purchaseId: created.id,
              createdById: actorUserId,
            })),
          });
        } else {
          // c.2.b. Upsert StockLevel (incrementa qty)
          await tx.stockLevel.upsert({
            where: {
              productId_locationId: {
                productId: product.id,
                locationId: item.locationId,
              },
            },
            create: {
              tenantId,
              productId: product.id,
              locationId: item.locationId,
              quantity: item.quantity,
            },
            update: {
              quantity: { increment: item.quantity },
            },
          });

          // c.3.b. 1 StockMovement por linha
          await tx.stockMovement.create({
            data: {
              tenantId,
              type: 'PURCHASE',
              productId: product.id,
              serialItemId: null,
              fromLocationId: null,
              toLocationId: item.locationId,
              quantity: item.quantity,
              unitCost: item.unitCost,
              totalCost: itemTotal,
              purchaseId: created.id,
              createdById: actorUserId,
            },
          });
        }

        // Audit por item dentro da transaction — se trans falha, audit também
        // some (consistência total). PurchaseItem.id é estável.
        void purchaseItem;
      }

      return created;
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'purchase.created',
      resource: 'purchases',
      resourceId: purchase.id,
      afterState: {
        supplierId: input.supplierId,
        items: input.items.length,
        totalCost,
      },
    });

    return this.findById(tenantId, purchase.id);
  }
}
