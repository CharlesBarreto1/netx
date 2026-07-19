import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { SupplierPayablesService } from '../finance/supplier-payables.service';
import { PrismaService } from '../prisma/prisma.service';

import { allocateAssetTags, withAssetTagRetry } from './asset-tag';
import { ProductsService } from './products.service';
import { StockLocationsService } from './stock-locations.service';

import type { Prisma, Product, Supplier } from '@prisma/client';
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
  payables: { orderBy: { installmentNumber: 'asc' as const } },
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
    private readonly payables: SupplierPayablesService,
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
      payables: p.payables.map((pay) => ({
        id: pay.id,
        installmentNumber: pay.installmentNumber,
        installmentCount: pay.installmentCount,
        amount: pay.amount,
        dueDate: pay.dueDate,
        status: pay.status,
        paidAt: pay.paidAt,
        paidVia: pay.paidVia,
        cashRegisterId: pay.cashRegisterId,
      })),
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
  ): Promise<{ productById: Map<string, Product>; supplier: Supplier }> {
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
        // Lançamento PARCIAL é permitido (0 <= serials <= quantity). O restante
        // é digitado depois via addSerials. Só barra excesso.
        if (item.serials.length > Math.floor(item.quantity)) {
          throw new BadRequestException(
            `Produto ${product.sku} é PATRIMONIAL — no máximo ${item.quantity} serial(s), recebeu ${item.serials.length}`,
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

    return { productById, supplier };
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

      const purchaseItem = await tx.purchaseItem.create({
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
      // quantidade ANTERIOR ao incremento. Pra PATRIMONIAL a quantidade que de
      // fato entra é o nº de seriais criados agora (pode ser parcial, < quantity);
      // os seriais restantes recalculam a média quando forem adicionados.
      const inboundQty =
        product.type === 'PATRIMONIAL' ? item.serials.length : item.quantity;
      if (incrementalCost && inboundQty > 0) {
        await this.products.recalcAverageCost(
          tx,
          product.id,
          inboundQty,
          item.unitCost,
        );
      }

      if (product.type === 'PATRIMONIAL') {
        // Cria N SerialItems vinculados à linha (purchaseItemId). N pode ser
        // 0 (lançamento parcial) — nesse caso nada é criado aqui.
        // Cada um nasce com código de patrimônio: é a compra que dá identidade
        // ao bem, não o cadastro manual depois.
        const tags = await allocateAssetTags(tx, tenantId, item.serials.length);
        await tx.serialItem.createMany({
          data: item.serials.map((serial, i) => ({
            tenantId,
            productId: product.id,
            purchaseItemId: purchaseItem.id,
            serial: serial.trim(),
            assetTag: tags[i].assetTag,
            assetSeq: tags[i].assetSeq,
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
    /** Tem cash_registers.manage — bypassa membership de caixa (à vista). */
    isManager = false,
  ) {
    const { productById, supplier } = await this.validateInput(
      tenantId,
      actorUserId,
      input,
    );

    const totalCost = input.items.reduce(
      (acc, i) => acc + i.quantity * i.unitCost,
      0,
    );
    const roundedTotal = Math.round(totalCost * 10000) / 10000;

    if (input.payment) {
      await this.payables.validatePurchasePayment(
        tenantId,
        actorUserId,
        isManager,
        input.payment,
        roundedTotal,
      );
    }

    // ──────────────────────────────────────────────────────────────────────
    // TRANSAÇÃO ATÔMICA
    // ──────────────────────────────────────────────────────────────────────
    // Retry envolve só a transação: sob corrida no sequencial de patrimônio
    // o rollback desfez tudo, e as validações acima não precisam repetir.
    const purchase = await withAssetTagRetry(() =>
      this.prisma.$transaction(async (tx) => {
      const created = await tx.purchase.create({
        data: {
          tenantId,
          supplierId: input.supplierId,
          invoiceNumber: input.invoiceNumber ?? null,
          date: new Date(input.date),
          totalCost: roundedTotal,
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

      // Contas a pagar — à vista (1 parcela paga, com saída de caixa opcional)
      // ou a prazo (N parcelas em aberto). Mesma transação da compra.
      if (input.payment) {
        await this.payables.createForPurchaseTx(tx, {
          tenantId,
          actorUserId,
          purchaseId: created.id,
          supplierId: supplier.id,
          supplierName: supplier.name,
          invoiceNumber: input.invoiceNumber ?? null,
          purchaseDate: new Date(input.date),
          totalCost: roundedTotal,
          payment: input.payment,
        });
      }

      return created;
      }),
    );

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
    /** Tem cash_registers.manage — bypassa membership de caixa (à vista). */
    isManager = false,
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

    // Parcela paga no contas a pagar prende a compra — estorna a baixa antes.
    await this.payables.assertPurchaseUnlocked(tenantId, purchaseId, 'editar');

    // Serials criados pela própria compra não contam como "já cadastrados"
    // na validação do payload novo — eles serão revertidos antes do reapply.
    const ignoreSerialsByProduct = new Map<string, Set<string>>();
    for (const item of purchase.items) {
      if (item.product.type !== 'PATRIMONIAL') continue;
      const set = ignoreSerialsByProduct.get(item.productId) ?? new Set<string>();
      item.serials.forEach((s) => set.add(s.trim()));
      ignoreSerialsByProduct.set(item.productId, set);
    }

    const { productById, supplier } = await this.validateInput(
      tenantId,
      actorUserId,
      input,
      {
        excludePurchaseId: purchaseId,
        ignoreSerialsByProduct,
      },
    );

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
    const roundedTotal = Math.round(totalCost * 10000) / 10000;

    if (input.payment) {
      await this.payables.validatePurchasePayment(
        tenantId,
        actorUserId,
        isManager,
        input.payment,
        roundedTotal,
      );
    }
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
          totalCost: roundedTotal,
          notes: input.notes ?? null,
          updatedById: actorUserId,
        },
      });

      // 4. Reaplica os itens novos (sem recálculo incremental — passo 6).
      await this.applyItemsTx(
        tx,
        tenantId,
        actorUserId,
        purchaseId,
        input,
        productById,
        false,
      );

      // 5. Regenera o contas a pagar: remove as parcelas antigas (nenhuma
      //    paga — travado acima) e recria conforme o payment novo (se houver).
      await this.payables.deleteForPurchaseTx(tx, tenantId, purchaseId);
      if (input.payment) {
        await this.payables.createForPurchaseTx(tx, {
          tenantId,
          actorUserId,
          purchaseId,
          supplierId: supplier.id,
          supplierName: supplier.name,
          invoiceNumber: input.invoiceNumber ?? null,
          purchaseDate: new Date(input.date),
          totalCost: roundedTotal,
          payment: input.payment,
        });
      }

      // 6. Recomputa o custo médio de TODOS os produtos envolvidos
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
      payment: input.payment
        ? {
            condition: input.payment.condition,
            installments: input.payment.installments?.length ?? 1,
            cashRegisterId: input.payment.cashRegisterId ?? null,
          }
        : null,
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

  // ───────────────────────────────────────────────────────────────────────────
  // ENTRADA INCREMENTAL de seriais numa linha PATRIMONIAL já lançada.
  // Resolve o caso do lote grande (ex.: 2000 ONTs): lança-se a NF com as
  // quantidades e vai-se digitando/escaneando os seriais aos poucos, sem REPLACE
  // e sem trava de "nada movido". Cada serial vira SerialItem + kardex na hora.
  // ───────────────────────────────────────────────────────────────────────────

  /** Carrega a linha + valida que é PATRIMONIAL e pertence à compra/tenant. */
  private async loadPatrimonialItem(
    tenantId: string,
    purchaseId: string,
    itemId: string,
  ) {
    const item = await this.prisma.purchaseItem.findFirst({
      where: { id: itemId, purchaseId, tenantId },
      include: {
        purchase: { select: { date: true } },
        product: { select: { id: true, sku: true, type: true } },
      },
    });
    if (!item) throw new NotFoundException('Item de compra não encontrado');
    if (item.product.type !== 'PATRIMONIAL') {
      throw new BadRequestException(
        'Seriais só se aplicam a itens PATRIMONIAIS.',
      );
    }
    return item;
  }

  /**
   * Lista os seriais (SerialItem) de uma linha de compra, com status e local —
   * usado pela tela de gestão de seriais (renomear/remover pontualmente).
   */
  async listItemSerials(tenantId: string, purchaseId: string, itemId: string) {
    const item = await this.loadPatrimonialItem(tenantId, purchaseId, itemId);
    const serials = await this.prisma.serialItem.findMany({
      where: { tenantId, purchaseItemId: item.id },
      orderBy: { serial: 'asc' },
      include: {
        location: { select: { name: true } },
        contract: { select: { code: true } },
      },
    });
    return {
      itemId: item.id,
      productSku: item.product.sku,
      quantity: Number(item.quantity),
      registered: serials.length,
      serials: serials.map((s) => ({
        id: s.id,
        serial: s.serial,
        status: s.status,
        locationName: s.location?.name ?? null,
        contractCode: s.contract?.code ?? null,
      })),
    };
  }

  /**
   * Adiciona um lote de seriais a uma linha PATRIMONIAL. Valida: não exceder a
   * quantidade da linha, únicos no lote e sem colisão no DB. Cria os SerialItems
   * (IN_STOCK, no local da linha), o kardex (PURCHASE) e atualiza o cache
   * desnormalizado `serials`. Recalcula o custo médio com as unidades que
   * entraram agora. Não toca financeiro (total da NF independe da serialização).
   */
  async addSerials(
    tenantId: string,
    actorUserId: string,
    purchaseId: string,
    itemId: string,
    rawSerials: string[],
  ) {
    const item = await this.loadPatrimonialItem(tenantId, purchaseId, itemId);

    // Precisa de acesso de escrita no local onde a linha foi recebida.
    await this.locations.assertCanWrite(tenantId, actorUserId, item.locationId);

    const serials = rawSerials.map((s) => s.trim()).filter((s) => s.length > 0);
    if (serials.length === 0) {
      throw new BadRequestException('Informe pelo menos 1 serial.');
    }
    // Únicos dentro do lote.
    const set = new Set(serials);
    if (set.size !== serials.length) {
      throw new BadRequestException('Há seriais duplicados no lote.');
    }

    const already = item.serials.length;
    const capacity = Math.floor(Number(item.quantity)) - already;
    if (serials.length > capacity) {
      throw new BadRequestException(
        `A linha comporta mais ${capacity} serial(is) (${already}/${Math.floor(
          Number(item.quantity),
        )} já cadastrados), recebeu ${serials.length}.`,
      );
    }

    // Colisão com seriais já existentes do mesmo produto (qualquer compra).
    const existing = await this.prisma.serialItem.findMany({
      where: { tenantId, productId: item.productId, serial: { in: serials } },
      select: { serial: true },
    });
    if (existing.length > 0) {
      throw new ConflictException(
        `Serial(is) já cadastrado(s): ${existing.map((e) => e.serial).join(', ')}`,
      );
    }

    await withAssetTagRetry(() =>
      this.prisma.$transaction(async (tx) => {
      // Recalcula o custo médio ANTES de criar os seriais — o recalc incremental
      // usa a contagem ANTERIOR ao incremento (mesma ordem do caminho de criação).
      await this.products.recalcAverageCost(
        tx,
        item.productId,
        serials.length,
        Number(item.unitCost),
      );

      const tags = await allocateAssetTags(tx, tenantId, serials.length);
      await tx.serialItem.createMany({
        data: serials.map((serial, i) => ({
          tenantId,
          productId: item.productId,
          purchaseItemId: item.id,
          serial,
          assetTag: tags[i].assetTag,
          assetSeq: tags[i].assetSeq,
          status: 'IN_STOCK' as const,
          locationId: item.locationId,
          acquisitionCost: item.unitCost,
          acquisitionDate: item.purchase.date,
        })),
      });

      const created = await tx.serialItem.findMany({
        where: { tenantId, productId: item.productId, serial: { in: serials } },
        select: { id: true },
      });
      await tx.stockMovement.createMany({
        data: created.map((s) => ({
          tenantId,
          type: 'PURCHASE' as const,
          productId: item.productId,
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

      await tx.purchaseItem.update({
        where: { id: item.id },
        data: { serials: { push: serials } },
      });
      }),
    );

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'purchase.serials_added',
      resource: 'purchases',
      resourceId: purchaseId,
      afterState: { itemId: item.id, sku: item.product.sku, added: serials },
    });

    return this.listItemSerials(tenantId, purchaseId, itemId);
  }

  /**
   * Remove um serial adicionado por engano de uma linha PATRIMONIAL. Só é
   * permitido se aquele patrimônio ainda está IN_STOCK no local da linha, sem
   * contrato e sem movimentação posterior à compra (mesmas travas do delete).
   * Desfaz SerialItem + kardex, tira do cache `serials` e recomputa o custo.
   */
  async removeSerial(
    tenantId: string,
    actorUserId: string,
    purchaseId: string,
    itemId: string,
    serialItemId: string,
  ) {
    const item = await this.loadPatrimonialItem(tenantId, purchaseId, itemId);

    const serial = await this.prisma.serialItem.findFirst({
      where: { id: serialItemId, tenantId, purchaseItemId: item.id },
      select: { id: true, serial: true, status: true, locationId: true, contractId: true },
    });
    if (!serial) throw new NotFoundException('Serial não encontrado nesta linha.');

    if (
      serial.status !== 'IN_STOCK' ||
      serial.contractId ||
      serial.locationId !== item.locationId
    ) {
      throw new ConflictException(
        `Não dá pra remover ${serial.serial}: já foi movimentado (situação ${serial.status}${
          serial.contractId ? ', em contrato' : ''
        }). Corrija o serial (renomear) ou use um ajuste de estoque.`,
      );
    }
    // Movimentação posterior à compra?
    const extraMovements = await this.prisma.stockMovement.count({
      where: {
        tenantId,
        serialItemId: serial.id,
        OR: [{ purchaseId: null }, { purchaseId: { not: purchaseId } }],
      },
    });
    if (extraMovements > 0) {
      throw new ConflictException(
        `Não dá pra remover ${serial.serial}: já teve movimentação posterior. Use um ajuste de estoque.`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.stockMovement.deleteMany({
        where: { tenantId, serialItemId: serial.id, purchaseId },
      });
      await tx.serialItem.delete({ where: { id: serial.id } });
      await tx.purchaseItem.update({
        where: { id: item.id },
        data: { serials: item.serials.filter((s) => s !== serial.serial) },
      });
      await this.products.recomputeAverageCost(tx, item.productId);
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'purchase.serial_removed',
      resource: 'purchases',
      resourceId: purchaseId,
      beforeState: { itemId: item.id, sku: item.product.sku, serial: serial.serial },
    });

    return this.listItemSerials(tenantId, purchaseId, itemId);
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

    // Parcela paga no contas a pagar prende a compra — estorna a baixa antes.
    await this.payables.assertPurchaseUnlocked(tenantId, purchaseId, 'excluir');

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

      // 4. Deleta parcelas do contas a pagar (nenhuma paga — travado acima),
      //    itens e header.
      await this.payables.deleteForPurchaseTx(tx, tenantId, purchaseId);
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
