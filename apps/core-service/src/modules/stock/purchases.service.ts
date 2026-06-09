import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

import { ProductsService } from './products.service';
import { StockLocationsService } from './stock-locations.service';

import type { Prisma, Product } from '@prisma/client';
import type { CreatePurchaseRequest, UpdatePurchaseRequest } from '@netx/shared';

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
 *
 * Edição (update) tem semântica de REPLACE: reverte os efeitos da compra
 * original (mesmas travas do delete — nada pode ter sido movimentado) e
 * reaplica os itens novos na mesma transação. Auditoria completa no AuditLog
 * (purchase.updated com before/after) + Purchase.updatedById (última edição).
 */

const PURCHASE_INCLUDE = {
  supplier: { select: { id: true, name: true } },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
  updatedBy: { select: { id: true, firstName: true, lastName: true } },
  items: {
    include: {
      product: { select: { id: true, sku: true, name: true, type: true } },
      location: { select: { id: true, code: true, name: true } },
    },
  },
} satisfies Prisma.PurchaseInclude;

type PurchaseWithIncludes = Prisma.PurchaseGetPayload<{
  include: typeof PURCHASE_INCLUDE;
}>;

function fullName(u: { firstName: string | null; lastName: string | null } | null): string | null {
  if (!u) return null;
  return [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || null;
}

@Injectable()
export class PurchasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly products: ProductsService,
    private readonly locations: StockLocationsService,
  ) {}

  // Achata o resultado do Prisma pro shape do PurchaseResponse (@netx/shared).
  // A UI espera supplierName/createdByName/productName/locationName no topo —
  // sem esse map ela renderizava "—" pra tudo.
  private mapPurchase(p: PurchaseWithIncludes) {
    return {
      id: p.id,
      tenantId: p.tenantId,
      supplierId: p.supplierId,
      supplierName: p.supplier?.name,
      invoiceNumber: p.invoiceNumber,
      date: p.date,
      totalCost: p.totalCost,
      notes: p.notes,
      createdById: p.createdById,
      createdByName: fullName(p.createdBy),
      createdAt: p.createdAt,
      updatedById: p.updatedById,
      updatedByName: fullName(p.updatedBy),
      updatedAt: p.updatedAt,
      items: p.items.map((it) => ({
        id: it.id,
        productId: it.productId,
        productName: it.product?.name,
        productSku: it.product?.sku,
        productType: it.product?.type,
        locationId: it.locationId,
        locationName: it.location ? `${it.location.code} — ${it.location.name}` : undefined,
        quantity: it.quantity,
        unitCost: it.unitCost,
        totalCost: it.totalCost,
        serials: it.serials,
        notes: it.notes,
      })),
    };
  }

  async list(
    tenantId: string,
    query?: { supplierId?: string; dateFrom?: string; dateTo?: string },
  ) {
    const rows = await this.prisma.purchase.findMany({
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
      include: PURCHASE_INCLUDE,
      take: 200,
    });
    return rows.map((p) => this.mapPurchase(p));
  }

  async findById(tenantId: string, id: string) {
    const purchase = await this.prisma.purchase.findFirst({
      where: { id, tenantId },
      include: PURCHASE_INCLUDE,
    });
    if (!purchase) throw new NotFoundException('Compra não encontrada');
    return this.mapPurchase(purchase);
  }

  /**
   * Trilha de auditoria da compra (purchase.created / updated / deleted).
   * Exposta sob stock.read (e não audit.read) pra quem opera estoque
   * conseguir ver o histórico sem precisar do módulo de auditoria global.
   */
  async auditTrail(tenantId: string, purchaseId: string) {
    const exists = await this.prisma.purchase.findFirst({
      where: { id: purchaseId, tenantId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('Compra não encontrada');

    const { data } = await this.audit.list({
      tenantId,
      resource: 'purchases',
      resourceId: purchaseId,
      page: 1,
      pageSize: 50,
    });
    return data.map((log) => ({
      id: log.id,
      action: log.action,
      createdAt: log.createdAt,
      userId: log.userId,
      userName: fullName(log.user ?? null) ?? log.user?.email ?? log.actor ?? null,
      beforeState: log.beforeState,
      afterState: log.afterState,
    }));
  }

  // ───────────────────────────────────────────────────────────────────────────
  // VALIDAÇÕES PRÉVIAS (create + update) — falhar rápido ANTES de abrir
  // transação, pra que erros 4xx típicos (Zod / not found / forbidden) não
  // consumam locks de transaction desnecessariamente.
  //
  // opts.excludePurchaseId / opts.ignoreSerialsByProduct: usados na edição —
  // a própria compra não conflita com a NF dela, e os serials que ELA criou
  // serão revertidos antes do reapply, então não contam como "já cadastrados".
  // ───────────────────────────────────────────────────────────────────────────
  private async validateInput(
    tenantId: string,
    actorUserId: string,
    input: CreatePurchaseRequest,
    opts?: {
      excludePurchaseId?: string;
      ignoreSerialsByProduct?: Map<string, Set<string>>;
    },
  ): Promise<Map<string, Product>> {
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
        // serials já existentes no DB (ignorando os da própria compra em edição)
        const ignore = opts?.ignoreSerialsByProduct?.get(product.id);
        const toCheck = Array.from(set).filter((s) => !ignore?.has(s));
        if (toCheck.length > 0) {
          const existing = await this.prisma.serialItem.findMany({
            where: {
              tenantId,
              productId: product.id,
              serial: { in: toCheck },
            },
            select: { serial: true },
          });
          if (existing.length > 0) {
            throw new ConflictException(
              `Produto ${product.sku}: serial(is) já cadastrado(s): ${existing.map((e) => e.serial).join(', ')}`,
            );
          }
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
          ...(opts?.excludePurchaseId ? { id: { not: opts.excludePurchaseId } } : {}),
        },
      });
      if (conflict) {
        throw new ConflictException(
          `Compra com NF ${input.invoiceNumber} desse fornecedor já existe`,
        );
      }
    }

    return productById;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // APLICA os itens da compra dentro da transação: PurchaseItems, SerialItems /
  // StockLevel e StockMovements. `incrementalCost` controla o recálculo do
  // custo médio: true no create (incremental por item); false no update — lá o
  // custo é recomputado do zero no final (recomputeAverageCost), igual ao delete.
  // ───────────────────────────────────────────────────────────────────────────
  private async applyItemsTx(
    tx: Prisma.TransactionClient,
    tenantId: string,
    actorUserId: string,
    purchaseId: string,
    input: CreatePurchaseRequest,
    productById: Map<string, Product>,
    incrementalCost: boolean,
  ): Promise<void> {
    for (const item of input.items) {
      const product = productById.get(item.productId)!;
      const itemTotal = Math.round(item.quantity * item.unitCost * 10000) / 10000;

      await tx.purchaseItem.create({
        data: {
          tenantId,
          purchaseId,
          productId: product.id,
          locationId: item.locationId,
          quantity: item.quantity,
          unitCost: item.unitCost,
          totalCost: itemTotal,
          serials: item.serials,
          notes: item.notes ?? null,
        },
      });

      // Recalcula custo médio do produto ANTES de atualizar saldo — usa a
      // quantidade ANTERIOR ao incremento.
      if (incrementalCost) {
        await this.products.recalcAverageCost(
          tx,
          product.id,
          item.quantity,
          item.unitCost,
        );
      }

      if (product.type === 'PATRIMONIAL') {
        // Cria N SerialItems
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

        // Cria 1 StockMovement por unidade — kardex granular por serial
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
            purchaseId,
            createdById: actorUserId,
          })),
        });
      } else {
        // Upsert StockLevel (incrementa qty)
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

        // 1 StockMovement por linha
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
            purchaseId,
            createdById: actorUserId,
          },
        });
      }
    }
  }

  async create(
    tenantId: string,
    actorUserId: string,
    input: CreatePurchaseRequest,
  ) {
    const productById = await this.validateInput(tenantId, actorUserId, input);

    const totalCost = input.items.reduce(
      (acc, i) => acc + i.quantity * i.unitCost,
      0,
    );

    // ──────────────────────────────────────────────────────────────────────
    // TRANSAÇÃO ATÔMICA
    // ──────────────────────────────────────────────────────────────────────
    const purchase = await this.prisma.$transaction(async (tx) => {
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

      await this.applyItemsTx(
        tx,
        tenantId,
        actorUserId,
        created.id,
        input,
        productById,
        true,
      );

      return created;
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'purchase.created',
      resource: 'purchases',
      resourceId: purchase.id,
      afterState: this.auditState(input, totalCost),
    });

    return this.findById(tenantId, purchase.id);
  }

  /**
   * Edita uma compra lançada errada (REPLACE total): reverte os efeitos da
   * versão original — mesmas travas do delete (nada pode ter sido alocado,
   * transferido ou consumido) — e reaplica os itens novos na MESMA transação.
   * Custo médio é recomputado do zero (replay do kardex) pra todos os produtos
   * envolvidos (antigos e novos). Registra purchase.updated com before/after.
   */
  async update(
    tenantId: string,
    actorUserId: string,
    purchaseId: string,
    input: UpdatePurchaseRequest,
  ) {
    const purchase = await this.prisma.purchase.findFirst({
      where: { id: purchaseId, tenantId },
      include: {
        items: {
          include: {
            product: { select: { id: true, sku: true, name: true, type: true } },
          },
        },
      },
    });
    if (!purchase) throw new NotFoundException('Compra não encontrada');

    // Serials criados pela própria compra não contam como "já cadastrados"
    // na validação do payload novo — eles serão revertidos antes do reapply.
    const ignoreSerialsByProduct = new Map<string, Set<string>>();
    for (const item of purchase.items) {
      if (item.product.type !== 'PATRIMONIAL') continue;
      const set = ignoreSerialsByProduct.get(item.productId) ?? new Set<string>();
      item.serials.forEach((s) => set.add(s.trim()));
      ignoreSerialsByProduct.set(item.productId, set);
    }

    const productById = await this.validateInput(tenantId, actorUserId, input, {
      excludePurchaseId: purchaseId,
      ignoreSerialsByProduct,
    });

    // Travas de reversão — iguais às do delete.
    const affectedProductIds = await this.assertRevertible(
      tenantId,
      purchase,
      'editar',
    );
    for (const pid of productById.keys()) affectedProductIds.add(pid);

    const totalCost = input.items.reduce(
      (acc, i) => acc + i.quantity * i.unitCost,
      0,
    );
    const beforeState = {
      supplierId: purchase.supplierId,
      invoiceNumber: purchase.invoiceNumber,
      date: purchase.date.toISOString(),
      notes: purchase.notes,
      totalCost: Number(purchase.totalCost),
      items: purchase.items.map((it) => ({
        sku: it.product.sku,
        locationId: it.locationId,
        quantity: Number(it.quantity),
        unitCost: Number(it.unitCost),
        serials: it.serials,
      })),
    };

    // ── EDIÇÃO atômica: reverte a versão antiga e reaplica a nova ───────────
    await this.prisma.$transaction(async (tx) => {
      // 1. Remove os movimentos do kardex da versão antiga.
      await tx.stockMovement.deleteMany({ where: { tenantId, purchaseId } });

      // 2. Reverte os efeitos de cada item antigo.
      for (const item of purchase.items) {
        if (item.product.type === 'PATRIMONIAL') {
          await tx.serialItem.deleteMany({
            where: {
              tenantId,
              productId: item.productId,
              serial: { in: item.serials.map((s) => s.trim()) },
            },
          });
        } else {
          await tx.stockLevel.update({
            where: {
              productId_locationId: {
                productId: item.productId,
                locationId: item.locationId,
              },
            },
            data: { quantity: { decrement: item.quantity } },
          });
        }
      }
      await tx.purchaseItem.deleteMany({ where: { purchaseId } });

      // 3. Atualiza o header com os dados novos + marca quem editou.
      await tx.purchase.update({
        where: { id: purchaseId },
        data: {
          supplierId: input.supplierId,
          invoiceNumber: input.invoiceNumber ?? null,
          date: new Date(input.date),
          totalCost: Math.round(totalCost * 10000) / 10000,
          notes: input.notes ?? null,
          updatedById: actorUserId,
        },
      });

      // 4. Reaplica os itens novos (sem recálculo incremental — passo 5).
      await this.applyItemsTx(
        tx,
        tenantId,
        actorUserId,
        purchaseId,
        input,
        productById,
        false,
      );

      // 5. Recomputa o custo médio de TODOS os produtos envolvidos
      //    (removidos, alterados e adicionados) via replay do kardex.
      for (const pid of affectedProductIds) {
        await this.products.recomputeAverageCost(tx, pid);
      }
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'purchase.updated',
      resource: 'purchases',
      resourceId: purchaseId,
      beforeState,
      afterState: this.auditState(input, totalCost, productById),
    });

    return this.findById(tenantId, purchaseId);
  }

  // Snapshot do payload pro AuditLog (before/after legível, sem dados sensíveis).
  private auditState(
    input: CreatePurchaseRequest,
    totalCost: number,
    productById?: Map<string, Product>,
  ) {
    return {
      supplierId: input.supplierId,
      invoiceNumber: input.invoiceNumber ?? null,
      date: input.date,
      notes: input.notes ?? null,
      totalCost: Math.round(totalCost * 10000) / 10000,
      items: input.items.map((it) => ({
        sku: productById?.get(it.productId)?.sku ?? it.productId,
        locationId: it.locationId,
        quantity: it.quantity,
        unitCost: it.unitCost,
        serials: it.serials,
      })),
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // TRAVAS de reversão (delete + update): garante que dá pra desfazer a compra
  // sem inconsistência. Retorna o set de productIds afetados.
  // ───────────────────────────────────────────────────────────────────────────
  private async assertRevertible(
    tenantId: string,
    purchase: {
      id: string;
      items: Array<{
        productId: string;
        locationId: string;
        quantity: Prisma.Decimal;
        serials: string[];
        product: { sku: string; type: string };
      }>;
    },
    verb: 'excluir' | 'editar',
  ): Promise<Set<string>> {
    const affectedProductIds = new Set<string>();
    for (const item of purchase.items) {
      affectedProductIds.add(item.productId);

      if (item.product.type === 'PATRIMONIAL') {
        const serials = item.serials.map((s) => s.trim());
        const rows = await this.prisma.serialItem.findMany({
          where: { tenantId, productId: item.productId, serial: { in: serials } },
          select: { id: true, serial: true, status: true, locationId: true, contractId: true },
        });
        for (const sn of rows) {
          if (
            sn.status !== 'IN_STOCK' ||
            sn.contractId ||
            sn.locationId !== item.locationId
          ) {
            throw new ConflictException(
              `Não dá pra ${verb}: o item ${sn.serial} (${item.product.sku}) já foi ` +
                `movimentado (situação ${sn.status}${sn.contractId ? ', em contrato' : ''}). ` +
                'Use um ajuste de estoque manual.',
            );
          }
        }
        // Movimentação posterior à compra (transferência/comodato/ajuste)?
        if (rows.length > 0) {
          const extraMovements = await this.prisma.stockMovement.count({
            where: {
              tenantId,
              serialItemId: { in: rows.map((r) => r.id) },
              OR: [{ purchaseId: null }, { purchaseId: { not: purchase.id } }],
            },
          });
          if (extraMovements > 0) {
            throw new ConflictException(
              `Não dá pra ${verb}: algum item de ${item.product.sku} já teve ` +
                'movimentação posterior. Use um ajuste de estoque manual.',
            );
          }
        }
      } else {
        // CONSUMÍVEL: precisa haver saldo suficiente no local pra estornar.
        const level = await this.prisma.stockLevel.findUnique({
          where: {
            productId_locationId: { productId: item.productId, locationId: item.locationId },
          },
          select: { quantity: true },
        });
        const have = Number(level?.quantity ?? 0);
        if (have < Number(item.quantity)) {
          throw new ConflictException(
            `Não dá pra ${verb}: o consumível ${item.product.sku} já foi parcialmente ` +
              `consumido (saldo ${have} < ${item.quantity} comprados). Use um ajuste manual.`,
          );
        }
      }
    }
    return affectedProductIds;
  }

  /**
   * Exclui (reverte) um lançamento de compra — pra corrigir erro de digitação
   * (produto/serial/fornecedor errados). Só é permitido se NADA aconteceu com o
   * que entrou: itens patrimoniais ainda IN_STOCK no mesmo local, sem contrato e
   * sem movimentação posterior; consumíveis com saldo suficiente pra estornar.
   * Desfaz tudo numa transação (serials, saldo, kardex, header) e recomputa o
   * custo médio. Quem já movimentou o item deve usar ajuste manual, não excluir.
   */
  async delete(
    tenantId: string,
    actorUserId: string,
    purchaseId: string,
  ): Promise<void> {
    const purchase = await this.prisma.purchase.findFirst({
      where: { id: purchaseId, tenantId },
      include: {
        items: {
          include: {
            product: { select: { id: true, sku: true, name: true, type: true } },
          },
        },
      },
    });
    if (!purchase) throw new NotFoundException('Compra não encontrada');

    const affectedProductIds = await this.assertRevertible(
      tenantId,
      purchase,
      'excluir',
    );

    // ── EXCLUSÃO atômica ────────────────────────────────────────────────────
    await this.prisma.$transaction(async (tx) => {
      // 1. Remove os movimentos do kardex desta compra.
      await tx.stockMovement.deleteMany({ where: { tenantId, purchaseId } });

      for (const item of purchase.items) {
        if (item.product.type === 'PATRIMONIAL') {
          // 2. Deleta os SerialItems criados (todos IN_STOCK e intocados).
          await tx.serialItem.deleteMany({
            where: {
              tenantId,
              productId: item.productId,
              serial: { in: item.serials.map((s) => s.trim()) },
            },
          });
        } else {
          // 3. Estorna o saldo do consumível.
          await tx.stockLevel.update({
            where: {
              productId_locationId: {
                productId: item.productId,
                locationId: item.locationId,
              },
            },
            data: { quantity: { decrement: item.quantity } },
          });
        }
      }

      // 4. Deleta itens + header.
      await tx.purchaseItem.deleteMany({ where: { purchaseId } });
      await tx.purchase.delete({ where: { id: purchaseId } });

      // 5. Recomputa o custo médio dos produtos afetados (kardex já sem a compra).
      for (const pid of affectedProductIds) {
        await this.products.recomputeAverageCost(tx, pid);
      }
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'purchase.deleted',
      resource: 'purchases',
      resourceId: purchaseId,
      beforeState: {
        supplierId: purchase.supplierId,
        invoiceNumber: purchase.invoiceNumber,
        totalCost: Number(purchase.totalCost),
        items: purchase.items.length,
      },
    });
  }
}
