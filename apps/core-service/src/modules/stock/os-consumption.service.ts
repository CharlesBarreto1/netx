import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

import { StockLocationsService } from './stock-locations.service';

/**
 * OsConsumptionService — registra consumo de materiais em uma OS.
 *
 * Regra de negócio:
 *   - Só produtos CONSUMIVEL podem ser consumidos em OS (patrimoniais vão por
 *     comodato/devolução, fluxo separado).
 *   - Movimento é OUT (saída) por isso usa `fromLocationId`.
 *   - Custo do consumo = Product.cost atual (custo médio ponderado).
 *   - StockLevel decrementa atomicamente. Se ficar negativo → BadRequest
 *     (configurável no futuro via tenant setting).
 *   - Cada item gera 1 StockMovement(OS_CONSUMPTION) ligado ao serviceOrderId.
 *
 * Uso típico:
 *   - Chamado pelo ServiceOrdersService no momento de `complete()` ou via
 *     endpoint dedicado se a técnica registrar consumo durante a OS antes de
 *     finalizar.
 */
export interface ConsumptionItem {
  productId: string;
  locationId: string;
  quantity: number;
  notes?: string | null;
}

@Injectable()
export class OsConsumptionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly locations: StockLocationsService,
  ) {}

  /**
   * Registra consumo de N itens numa OS. Atomico — se um item falhar, nada
   * acontece. Validações:
   *   - OS existe + pertence ao tenant + não está cancelada
   *   - cada produto é CONSUMIVEL
   *   - operador tem acesso de escrita em cada `locationId`
   *   - saldo suficiente em StockLevel pra cada (produto, local)
   *
   * Retorna a lista de StockMovements criados (pra UI mostrar feedback).
   */
  async addConsumption(
    tenantId: string,
    actorUserId: string,
    input: {
      serviceOrderId: string;
      items: ConsumptionItem[];
    },
    options: { isAdmin?: boolean } = {},
  ) {
    if (input.items.length === 0) {
      throw new BadRequestException('Nenhum item informado pra consumo');
    }

    // Pré-check ACL fora da transaction (mais barato)
    const distinctLocations = new Set(input.items.map((i) => i.locationId));
    for (const locId of distinctLocations) {
      const canWrite = await this.locations.canUserWrite(
        locId,
        actorUserId,
        options.isAdmin ?? false,
      );
      if (!canWrite) {
        throw new BadRequestException(
          `Sem permissão pra escrever no local ${locId}`,
        );
      }
    }

    return this.prisma.$transaction(async (tx) => {
      // 1. Confere OS
      const os = await tx.serviceOrder.findFirst({
        where: { id: input.serviceOrderId, tenantId, deletedAt: null },
        select: { id: true, status: true, contractId: true, code: true },
      });
      if (!os) throw new NotFoundException('OS não encontrada');
      if (os.status === 'CANCELLED') {
        throw new BadRequestException(
          'Não dá pra consumir materiais em OS cancelada',
        );
      }

      const movements = [];

      for (const item of input.items) {
        if (item.quantity <= 0) {
          throw new BadRequestException(
            `Quantidade inválida pra produto ${item.productId}: ${item.quantity}`,
          );
        }

        // 2. Confere produto (consumível, ativo)
        const product = await tx.product.findFirst({
          where: { id: item.productId, tenantId, deletedAt: null },
          select: { id: true, type: true, name: true, cost: true, sku: true },
        });
        if (!product) {
          throw new NotFoundException(`Produto ${item.productId} não encontrado`);
        }
        if (product.type !== 'CONSUMIVEL') {
          throw new BadRequestException(
            `Produto "${product.name}" não é consumível — patrimoniais vão por comodato`,
          );
        }

        // 3. Confere saldo no local
        const level = await tx.stockLevel.findUnique({
          where: {
            productId_locationId: {
              productId: item.productId,
              locationId: item.locationId,
            },
          },
        });
        const currentQty = Number(level?.quantity ?? 0);
        if (currentQty < item.quantity) {
          throw new BadRequestException(
            `Saldo insuficiente de "${product.name}" (SKU ${product.sku}) no local: ` +
              `tem ${currentQty}, precisa ${item.quantity}`,
          );
        }

        // 4. Decrementa saldo
        await tx.stockLevel.update({
          where: {
            productId_locationId: {
              productId: item.productId,
              locationId: item.locationId,
            },
          },
          data: { quantity: currentQty - item.quantity },
        });

        // 5. Cria movimento
        const unitCost = Number(product.cost);
        const totalCost = unitCost * item.quantity;

        const mov = await tx.stockMovement.create({
          data: {
            tenantId,
            type: 'OS_CONSUMPTION',
            productId: item.productId,
            serialItemId: null,
            fromLocationId: item.locationId,
            toLocationId: null,
            quantity: item.quantity,
            unitCost,
            totalCost,
            serviceOrderId: os.id,
            // Bônus: também grava contractId pra facilitar relatórios "consumo
            // por cliente". Lê do contract da OS.
            contractId: os.contractId,
            notes: item.notes ?? null,
            createdById: actorUserId,
          },
        });

        movements.push(mov);
      }

      // 6. Audit consolidado
      await this.audit.log({
        tenantId,
        userId: actorUserId,
        action: 'os.consumption.added',
        resource: 'service_orders',
        resourceId: os.id,
        afterState: {
          osCode: os.code,
          itemCount: input.items.length,
          totalCost: movements.reduce(
            (acc, m) => acc + Number(m.totalCost),
            0,
          ),
        },
      });

      return movements;
    });
  }

  /**
   * Lista consumos de uma OS. Útil pra UI mostrar "materiais usados" + custo
   * agregado da OS.
   */
  async listByServiceOrder(tenantId: string, serviceOrderId: string) {
    return this.prisma.stockMovement.findMany({
      where: {
        tenantId,
        serviceOrderId,
        type: 'OS_CONSUMPTION',
      },
      include: {
        product: { select: { sku: true, name: true, unit: true } },
        fromLocation: { select: { code: true, name: true } },
        createdBy: { select: { firstName: true, lastName: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
