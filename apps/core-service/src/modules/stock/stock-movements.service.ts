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

import type {
  CreateAdjustmentRequest,
  CreateStockTransferRequest,
  ListStockMovementsQuery,
} from '@netx/shared';

/**
 * StockMovementsService — operações que NÃO são compra/venda/comodato:
 *
 *   - listKardex:  consulta histórico (kardex) com filtros
 *   - adjust:      ajuste manual de inventário (entrada/saída livre, contagem física,
 *                  perda, dano, achado)
 *   - transfer:    movimentação entre locais (cria par TRANSFER_OUT + TRANSFER_IN)
 *
 * Todas as operações verificam ACL no(s) local(is) envolvido(s) via
 * `locations.assertCanWrite`.
 *
 * Estoque negativo NUNCA é permitido — saída exige saldo >= quantidade.
 */
@Injectable()
export class StockMovementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly products: ProductsService,
    private readonly locations: StockLocationsService,
  ) {}

  async listKardex(tenantId: string, query: ListStockMovementsQuery) {
    const where: Prisma.StockMovementWhereInput = {
      tenantId,
      ...(query.productId ? { productId: query.productId } : {}),
      ...(query.serialItemId ? { serialItemId: query.serialItemId } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.locationId
        ? {
            OR: [
              { fromLocationId: query.locationId },
              { toLocationId: query.locationId },
            ],
          }
        : {}),
      ...(query.dateFrom || query.dateTo
        ? {
            createdAt: {
              ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
              ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
            },
          }
        : {}),
    };

    const [total, items] = await Promise.all([
      this.prisma.stockMovement.count({ where }),
      this.prisma.stockMovement.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          product: { select: { id: true, sku: true, name: true, type: true } },
          serialItem: { select: { id: true, serial: true } },
          fromLocation: { select: { id: true, code: true, name: true } },
          toLocation: { select: { id: true, code: true, name: true } },
          createdBy: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
    ]);

    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  /**
   * Ajuste manual de inventário. Cobre:
   *   - Contagem física (acerto pra cima/baixo)
   *   - Perda, dano, descarte (OUT)
   *   - Achado (IN)
   *
   * Atomic: tudo numa transaction.
   */
  async adjust(
    tenantId: string,
    actorUserId: string,
    input: CreateAdjustmentRequest,
  ) {
    const product = await this.prisma.product.findFirst({
      where: { id: input.productId, tenantId, deletedAt: null, isActive: true },
    });
    if (!product) throw new NotFoundException('Produto não encontrado');

    const location = await this.prisma.stockLocation.findFirst({
      where: { id: input.locationId, tenantId, deletedAt: null, isActive: true },
    });
    if (!location) throw new NotFoundException('Local não encontrado');

    await this.locations.assertCanWrite(tenantId, actorUserId, input.locationId);

    // Validação por tipo de produto
    if (product.type === 'PATRIMONIAL') {
      if (input.serials.length !== Math.floor(input.quantity)) {
        throw new BadRequestException(
          `PATRIMONIAL — passe ${input.quantity} serial(is)`,
        );
      }
      if (!Number.isInteger(input.quantity)) {
        throw new BadRequestException('PATRIMONIAL — quantidade precisa ser inteira');
      }
    } else if (input.serials.length > 0) {
      throw new BadRequestException('CONSUMIVEL — serials não devem ser passados');
    }

    if (input.direction === 'IN' && input.unitCost == null) {
      throw new BadRequestException(
        'Ajuste de entrada exige unitCost (custo unitário)',
      );
    }

    const unitCost = input.direction === 'IN' ? input.unitCost! : Number(product.cost);
    const totalCost = Math.round(input.quantity * unitCost * 10000) / 10000;

    const movementType = input.direction === 'IN' ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT';

    return this.prisma.$transaction(async (tx) => {
      if (input.direction === 'IN') {
        // Recalcula custo médio
        await this.products.recalcAverageCost(
          tx,
          product.id,
          input.quantity,
          unitCost,
        );

        if (product.type === 'PATRIMONIAL') {
          // Cria seriais
          const existing = await tx.serialItem.findMany({
            where: {
              tenantId,
              productId: product.id,
              serial: { in: input.serials.map((s) => s.trim()) },
            },
            select: { serial: true },
          });
          if (existing.length > 0) {
            throw new ConflictException(
              `Serial já existe: ${existing.map((e) => e.serial).join(', ')}`,
            );
          }

          await tx.serialItem.createMany({
            data: input.serials.map((serial) => ({
              tenantId,
              productId: product.id,
              serial: serial.trim(),
              status: 'IN_STOCK' as const,
              locationId: input.locationId,
              acquisitionCost: unitCost,
              acquisitionDate: new Date(),
              notes: `Ajuste de entrada: ${input.reason}`,
            })),
          });

          const createdSerials = await tx.serialItem.findMany({
            where: {
              tenantId,
              productId: product.id,
              serial: { in: input.serials.map((s) => s.trim()) },
            },
            select: { id: true },
          });

          await tx.stockMovement.createMany({
            data: createdSerials.map((s) => ({
              tenantId,
              type: 'ADJUSTMENT_IN' as const,
              productId: product.id,
              serialItemId: s.id,
              toLocationId: input.locationId,
              quantity: 1,
              unitCost,
              totalCost: unitCost,
              notes: `${input.reason}${input.notes ? ' — ' + input.notes : ''}`,
              createdById: actorUserId,
            })),
          });
        } else {
          // CONSUMIVEL — upsert level
          await tx.stockLevel.upsert({
            where: {
              productId_locationId: {
                productId: product.id,
                locationId: input.locationId,
              },
            },
            create: {
              tenantId,
              productId: product.id,
              locationId: input.locationId,
              quantity: input.quantity,
            },
            update: { quantity: { increment: input.quantity } },
          });

          await tx.stockMovement.create({
            data: {
              tenantId,
              type: 'ADJUSTMENT_IN',
              productId: product.id,
              toLocationId: input.locationId,
              quantity: input.quantity,
              unitCost,
              totalCost,
              notes: `${input.reason}${input.notes ? ' — ' + input.notes : ''}`,
              createdById: actorUserId,
            },
          });
        }
      } else {
        // OUT — saída
        if (product.type === 'PATRIMONIAL') {
          // Marca seriais como WRITTEN_OFF (ajuste pra fora é descarte definitivo)
          const serials = await tx.serialItem.findMany({
            where: {
              tenantId,
              productId: product.id,
              serial: { in: input.serials.map((s) => s.trim()) },
              status: 'IN_STOCK',
              locationId: input.locationId,
            },
          });
          if (serials.length !== input.serials.length) {
            throw new BadRequestException(
              'Algum serial não está IN_STOCK neste local',
            );
          }

          await tx.serialItem.updateMany({
            where: { id: { in: serials.map((s) => s.id) } },
            data: {
              status: 'WRITTEN_OFF',
              locationId: null,
              notes: `Ajuste de saída: ${input.reason}`,
            },
          });

          await tx.stockMovement.createMany({
            data: serials.map((s) => ({
              tenantId,
              type: 'ADJUSTMENT_OUT' as const,
              productId: product.id,
              serialItemId: s.id,
              fromLocationId: input.locationId,
              quantity: 1,
              unitCost,
              totalCost: unitCost,
              notes: `${input.reason}${input.notes ? ' — ' + input.notes : ''}`,
              createdById: actorUserId,
            })),
          });
        } else {
          // CONSUMIVEL — decrementa level com check de saldo
          const level = await tx.stockLevel.findUnique({
            where: {
              productId_locationId: {
                productId: product.id,
                locationId: input.locationId,
              },
            },
          });
          const currentQty = Number(level?.quantity ?? 0);
          if (currentQty < input.quantity) {
            throw new ConflictException(
              `Saldo insuficiente neste local: disponível ${currentQty}, solicitado ${input.quantity}`,
            );
          }
          await tx.stockLevel.update({
            where: {
              productId_locationId: {
                productId: product.id,
                locationId: input.locationId,
              },
            },
            data: { quantity: { decrement: input.quantity } },
          });

          await tx.stockMovement.create({
            data: {
              tenantId,
              type: 'ADJUSTMENT_OUT',
              productId: product.id,
              fromLocationId: input.locationId,
              quantity: input.quantity,
              unitCost,
              totalCost,
              notes: `${input.reason}${input.notes ? ' — ' + input.notes : ''}`,
              createdById: actorUserId,
            },
          });
        }
      }

      await this.audit.log({
        tenantId,
        userId: actorUserId,
        action: `stock.${movementType.toLowerCase()}`,
        resource: 'stock_movements',
        resourceId: product.id,
        metadata: {
          productSku: product.sku,
          locationId: input.locationId,
          quantity: input.quantity,
          reason: input.reason,
        },
      });

      return { ok: true };
    });
  }

  /**
   * Transfere entre locais — par de movimentos TRANSFER_OUT + TRANSFER_IN.
   * Para PATRIMONIAL: passa serialItemIds, status fica IN_TRANSIT só durante
   * a transação (instantâneo no DB, sem janela aberta).
   */
  async transfer(
    tenantId: string,
    actorUserId: string,
    input: CreateStockTransferRequest,
  ) {
    const product = await this.prisma.product.findFirst({
      where: { id: input.productId, tenantId, deletedAt: null, isActive: true },
    });
    if (!product) throw new NotFoundException('Produto não encontrado');

    const [fromLocation, toLocation] = await Promise.all([
      this.prisma.stockLocation.findFirst({
        where: {
          id: input.fromLocationId,
          tenantId,
          deletedAt: null,
          isActive: true,
        },
      }),
      this.prisma.stockLocation.findFirst({
        where: {
          id: input.toLocationId,
          tenantId,
          deletedAt: null,
          isActive: true,
        },
      }),
    ]);
    if (!fromLocation || !toLocation) {
      throw new NotFoundException('Local de origem ou destino não encontrado');
    }

    // Precisa write nos DOIS locais (ou pelo menos no `from`; o `to` pode ser
    // estrito também — operador "transferindo pra fora" precisa de permissão
    // pra TIRAR daqui E COLOCAR lá. Sendo conservador, exige ambos.)
    await this.locations.assertCanWrite(tenantId, actorUserId, input.fromLocationId);
    await this.locations.assertCanWrite(tenantId, actorUserId, input.toLocationId);

    if (product.type === 'PATRIMONIAL') {
      if (input.serialItemIds.length !== Math.floor(input.quantity)) {
        throw new BadRequestException(
          `PATRIMONIAL — passe ${input.quantity} serialItemId(s)`,
        );
      }
    } else if (input.serialItemIds.length > 0) {
      throw new BadRequestException('CONSUMIVEL — não passe serialItemIds');
    }

    const unitCost = Number(product.cost);
    const totalCost = Math.round(input.quantity * unitCost * 10000) / 10000;

    return this.prisma.$transaction(async (tx) => {
      if (product.type === 'PATRIMONIAL') {
        // Verifica seriais estão IN_STOCK no fromLocation
        const serials = await tx.serialItem.findMany({
          where: {
            id: { in: input.serialItemIds },
            tenantId,
            productId: product.id,
            status: 'IN_STOCK',
            locationId: input.fromLocationId,
          },
        });
        if (serials.length !== input.serialItemIds.length) {
          throw new BadRequestException(
            'Algum serial não está IN_STOCK no local de origem',
          );
        }

        // Move
        await tx.serialItem.updateMany({
          where: { id: { in: serials.map((s) => s.id) } },
          data: { locationId: input.toLocationId },
        });

        // Movimentos: OUT + IN por serial
        for (const serial of serials) {
          await tx.stockMovement.create({
            data: {
              tenantId,
              type: 'TRANSFER_OUT',
              productId: product.id,
              serialItemId: serial.id,
              fromLocationId: input.fromLocationId,
              quantity: 1,
              unitCost,
              totalCost: unitCost,
              notes: input.notes ?? null,
              createdById: actorUserId,
            },
          });
          await tx.stockMovement.create({
            data: {
              tenantId,
              type: 'TRANSFER_IN',
              productId: product.id,
              serialItemId: serial.id,
              toLocationId: input.toLocationId,
              quantity: 1,
              unitCost,
              totalCost: unitCost,
              notes: input.notes ?? null,
              createdById: actorUserId,
            },
          });
        }
      } else {
        // CONSUMIVEL — decrementa from, incrementa to. Checa saldo no from.
        const fromLevel = await tx.stockLevel.findUnique({
          where: {
            productId_locationId: {
              productId: product.id,
              locationId: input.fromLocationId,
            },
          },
        });
        if (!fromLevel || Number(fromLevel.quantity) < input.quantity) {
          throw new ConflictException(
            `Saldo insuficiente no local de origem: disponível ${fromLevel?.quantity ?? 0}, solicitado ${input.quantity}`,
          );
        }

        await tx.stockLevel.update({
          where: {
            productId_locationId: {
              productId: product.id,
              locationId: input.fromLocationId,
            },
          },
          data: { quantity: { decrement: input.quantity } },
        });

        await tx.stockLevel.upsert({
          where: {
            productId_locationId: {
              productId: product.id,
              locationId: input.toLocationId,
            },
          },
          create: {
            tenantId,
            productId: product.id,
            locationId: input.toLocationId,
            quantity: input.quantity,
          },
          update: { quantity: { increment: input.quantity } },
        });

        await tx.stockMovement.create({
          data: {
            tenantId,
            type: 'TRANSFER_OUT',
            productId: product.id,
            fromLocationId: input.fromLocationId,
            quantity: input.quantity,
            unitCost,
            totalCost,
            notes: input.notes ?? null,
            createdById: actorUserId,
          },
        });

        await tx.stockMovement.create({
          data: {
            tenantId,
            type: 'TRANSFER_IN',
            productId: product.id,
            toLocationId: input.toLocationId,
            quantity: input.quantity,
            unitCost,
            totalCost,
            notes: input.notes ?? null,
            createdById: actorUserId,
          },
        });
      }

      await this.audit.log({
        tenantId,
        userId: actorUserId,
        action: 'stock.transfer',
        resource: 'stock_movements',
        resourceId: product.id,
        metadata: {
          productSku: product.sku,
          fromLocationId: input.fromLocationId,
          toLocationId: input.toLocationId,
          quantity: input.quantity,
        },
      });

      return { ok: true };
    });
  }

  /**
   * Reverte um movimento de kardex lançado errado: ajuste de inventário
   * (ADJUSTMENT_IN/OUT) ou consumo em O.S (OS_CONSUMPTION). Desfaz o efeito no
   * saldo/serial, remove o movimento e recomputa o custo médio. Compra/comodato/
   * transferência/venda são bloqueados — revertem pela origem (compra: excluir
   * a compra; comodato: devolver no contrato; transferência: transferir de volta).
   */
  async reverseMovement(
    tenantId: string,
    actorUserId: string,
    movementId: string,
  ): Promise<void> {
    const mov = await this.prisma.stockMovement.findFirst({
      where: { id: movementId, tenantId },
      include: { product: { select: { id: true, sku: true, type: true } } },
    });
    if (!mov) throw new NotFoundException('Movimento não encontrado');

    const REVERSIBLE = ['ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'OS_CONSUMPTION'];
    if (!REVERSIBLE.includes(mov.type)) {
      const hint = mov.type.startsWith('PURCHASE')
        ? 'Reverta pela tela de Compras (excluir a compra).'
        : mov.type.startsWith('COMODATO')
          ? 'Reverta pelo comodato do contrato (devolver/alocar).'
          : mov.type.startsWith('TRANSFER')
            ? 'Pra desfazer uma transferência, faça a transferência inversa (do destino pra origem).'
            : 'Esse tipo de movimento não pode ser revertido aqui.';
      throw new BadRequestException(hint);
    }

    const qty = Number(mov.quantity);

    await this.prisma.$transaction(async (tx) => {
      if (mov.type === 'ADJUSTMENT_IN') {
        if (mov.product.type === 'PATRIMONIAL' && mov.serialItemId) {
          // Reverter entrada patrimonial = deletar o serial criado (se intocado).
          const sn = await tx.serialItem.findUnique({
            where: { id: mov.serialItemId },
            select: { id: true, serial: true, status: true, locationId: true, contractId: true },
          });
          if (
            !sn ||
            sn.status !== 'IN_STOCK' ||
            sn.contractId ||
            sn.locationId !== mov.toLocationId
          ) {
            throw new ConflictException(
              `Não dá pra reverter: o item ${sn?.serial ?? ''} já foi movimentado.`,
            );
          }
          const otherMov = await tx.stockMovement.count({
            where: { tenantId, serialItemId: sn.id, NOT: { id: mov.id } },
          });
          if (otherMov > 0) {
            throw new ConflictException(
              'Não dá pra reverter: o item já teve movimentação posterior.',
            );
          }
          await tx.serialItem.delete({ where: { id: sn.id } });
        } else if (mov.toLocationId) {
          await this.changeLevel(tx, tenantId, mov.productId, mov.toLocationId, -qty);
        }
      } else if (mov.type === 'ADJUSTMENT_OUT') {
        if (mov.product.type === 'PATRIMONIAL' && mov.serialItemId) {
          // Reverter saída patrimonial = ressuscitar o serial baixado.
          const sn = await tx.serialItem.findUnique({
            where: { id: mov.serialItemId },
            select: { id: true, status: true },
          });
          if (!sn || sn.status !== 'WRITTEN_OFF') {
            throw new ConflictException(
              'Não dá pra reverter: o item não está mais como baixado.',
            );
          }
          await tx.serialItem.update({
            where: { id: sn.id },
            data: { status: 'IN_STOCK', locationId: mov.fromLocationId, notes: null },
          });
        } else if (mov.fromLocationId) {
          await this.changeLevel(tx, tenantId, mov.productId, mov.fromLocationId, qty);
        }
      } else if (mov.type === 'OS_CONSUMPTION' && mov.fromLocationId) {
        // Reverter consumo = devolver a quantidade ao local.
        await this.changeLevel(tx, tenantId, mov.productId, mov.fromLocationId, qty);
      }

      await tx.stockMovement.delete({ where: { id: mov.id } });
      await this.products.recomputeAverageCost(tx, mov.productId);
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'stock.movement_reversed',
      resource: 'stock_movements',
      resourceId: movementId,
      beforeState: { type: mov.type, productSku: mov.product.sku, quantity: qty },
    });
  }

  /** Aplica um delta no StockLevel (cria se não existe; nunca deixa negativo). */
  private async changeLevel(
    tx: Prisma.TransactionClient,
    tenantId: string,
    productId: string,
    locationId: string,
    delta: number,
  ): Promise<void> {
    const level = await tx.stockLevel.findUnique({
      where: { productId_locationId: { productId, locationId } },
      select: { quantity: true },
    });
    const current = Number(level?.quantity ?? 0);
    const next = current + delta;
    if (next < 0) {
      throw new ConflictException(
        `Não dá pra reverter: deixaria o saldo negativo (atual ${current}).`,
      );
    }
    await tx.stockLevel.upsert({
      where: { productId_locationId: { productId, locationId } },
      create: { tenantId, productId, locationId, quantity: next },
      update: { quantity: next },
    });
  }
}
