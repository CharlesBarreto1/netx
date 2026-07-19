import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

import { StockLocationsService } from './stock-locations.service';

/**
 * DeploymentService — instala bem patrimonial na rede PRÓPRIA e recolhe.
 *
 * É o irmão do ComodatoService. A diferença não é técnica, é contábil:
 *   - comodato  → o bem vai pro CLIENTE (ALLOCATED + contractId)
 *   - deploy    → o bem vira ATIVO DA OPERAÇÃO (IN_USE + popId)
 *
 * Antes desta fase o segundo caso não tinha representação: um roteador de
 * núcleo comprado e instalado no POP ou ficava IN_STOCK (e o saldo disponível
 * mentia, contando equipamento que está em produção) ou saía por
 * ADJUSTMENT_OUT (e sumia do patrimônio). Nenhuma das duas dá pra auditar.
 *
 * Operações:
 *   - deploy():        IN_STOCK → IN_USE + StockMovement(DEPLOY_OUT)
 *                      popId setado; networkEquipmentId opcional (1:1 com a
 *                      Planta de rede); locationId = null (saiu do depósito)
 *   - returnToStock(): inverso — IN_USE → IN_STOCK no local informado
 *                      + StockMovement(DEPLOY_RETURN)
 *
 * Como no comodato, não pedimos `unitCost`: usamos o acquisitionCost do bem
 * (o que foi de fato pago na compra) pra preservar custo histórico.
 */
@Injectable()
export class DeploymentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly locations: StockLocationsService,
  ) {}

  // ---------------------------------------------------------------------------
  // QUERIES
  // ---------------------------------------------------------------------------

  /**
   * Bens instalados num POP. É o "inventário de campo": o que existe fisicamente
   * naquele site, incluindo o que já virou equipamento da planta.
   */
  async listByPop(tenantId: string, popId: string) {
    const pop = await this.prisma.networkPop.findFirst({
      where: { id: popId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!pop) throw new NotFoundException('POP não encontrado');

    const rows = await this.prisma.serialItem.findMany({
      where: { tenantId, popId, status: 'IN_USE' },
      include: {
        product: { select: { id: true, sku: true, name: true, brand: true, model: true } },
        networkEquipment: { select: { id: true, name: true, type: true, ipAddress: true } },
      },
      orderBy: [{ assetSeq: 'asc' }],
    });
    return rows.map((r) => ({
      id: r.id,
      serial: r.serial,
      assetTag: r.assetTag,
      status: r.status,
      deployedAt: r.deployedAt?.toISOString() ?? null,
      product: r.product,
      networkEquipment: r.networkEquipment,
    }));
  }

  /**
   * Bens disponíveis pra instalar (IN_STOCK, patrimoniais). Alimenta o seletor
   * do formulário de equipamento — é o que faz o cadastro consumir do estoque
   * em vez de redigitar.
   */
  async listAvailable(tenantId: string, filter: { productId?: string; locationId?: string } = {}) {
    const rows = await this.prisma.serialItem.findMany({
      where: {
        tenantId,
        status: 'IN_STOCK',
        product: { type: 'PATRIMONIAL', deletedAt: null },
        ...(filter.productId ? { productId: filter.productId } : {}),
        ...(filter.locationId ? { locationId: filter.locationId } : {}),
      },
      include: {
        product: { select: { id: true, sku: true, name: true, brand: true, model: true } },
        location: { select: { id: true, name: true } },
      },
      orderBy: [{ assetSeq: 'asc' }],
      take: 200,
    });
    return rows.map((r) => ({
      id: r.id,
      serial: r.serial,
      assetTag: r.assetTag,
      product: r.product,
      location: r.location,
    }));
  }

  // ---------------------------------------------------------------------------
  // MUTATIONS
  // ---------------------------------------------------------------------------

  /**
   * Instala um bem na rede própria.
   *
   * Idempotente quando já está no MESMO POP e mesmo equipamento — repetir a
   * operação (retry de rede, duplo clique) não gera segundo movimento.
   *
   * Aceita `tx` pra rodar dentro da transação de quem chamou: é assim que a
   * criação de equipamento da planta consome o estoque atomicamente — se o
   * equipamento falhar, o bem não sai do depósito.
   */
  async deploy(
    tenantId: string,
    actorUserId: string,
    input: {
      serialItemId: string;
      popId: string;
      networkEquipmentId?: string | null;
      notes?: string | null;
    },
    tx?: Prisma.TransactionClient,
  ) {
    const run = async (db: Prisma.TransactionClient) => {
      const pop = await db.networkPop.findFirst({
        where: { id: input.popId, tenantId, deletedAt: null },
        select: { id: true, name: true },
      });
      if (!pop) throw new NotFoundException('POP não encontrado');

      const serial = await db.serialItem.findFirst({
        where: { id: input.serialItemId, tenantId },
        include: { product: { select: { type: true, name: true } } },
      });
      if (!serial) throw new NotFoundException('Patrimônio não encontrado');
      if (serial.product.type !== 'PATRIMONIAL') {
        throw new BadRequestException(
          `Produto ${serial.product.name} não é patrimonial — não pode ser instalado`,
        );
      }

      // Já instalado?
      if (serial.status === 'IN_USE') {
        const sameSpot =
          serial.popId === input.popId &&
          (serial.networkEquipmentId ?? null) === (input.networkEquipmentId ?? null);
        if (sameSpot) return serial; // idempotente
        throw new ConflictException(
          `${serial.assetTag ?? serial.serial} já está instalado em outro ponto da rede — recolha primeiro`,
        );
      }
      if (serial.status === 'ALLOCATED') {
        throw new ConflictException(
          `${serial.assetTag ?? serial.serial} está em comodato com cliente — devolva o comodato primeiro`,
        );
      }
      if (serial.status !== 'IN_STOCK') {
        throw new BadRequestException(
          `Patrimônio em status ${serial.status} não pode ser instalado (esperado IN_STOCK)`,
        );
      }
      if (!serial.locationId) {
        throw new BadRequestException(
          'Patrimônio em IN_STOCK mas sem localização — corrija o estado primeiro',
        );
      }

      // Equipamento informado precisa existir, ser do tenant e estar livre.
      if (input.networkEquipmentId) {
        const equip = await db.networkEquipment.findFirst({
          where: { id: input.networkEquipmentId, tenantId, deletedAt: null },
          select: { id: true, name: true },
        });
        if (!equip) throw new NotFoundException('Equipamento da planta não encontrado');
        const taken = await db.serialItem.findFirst({
          where: {
            networkEquipmentId: input.networkEquipmentId,
            id: { not: serial.id },
          },
          select: { assetTag: true, serial: true },
        });
        if (taken) {
          throw new ConflictException(
            `Equipamento "${equip.name}" já é o patrimônio ${taken.assetTag ?? taken.serial}`,
          );
        }
      }

      const product = await db.product.findUnique({
        where: { id: serial.productId },
        select: { cost: true },
      });
      const unitCost = Number(serial.acquisitionCost ?? product?.cost ?? 0);

      const updated = await db.serialItem.update({
        where: { id: serial.id },
        data: {
          status: 'IN_USE',
          popId: input.popId,
          networkEquipmentId: input.networkEquipmentId ?? null,
          // Sai do depósito: está fisicamente no POP, não no almoxarifado.
          locationId: null,
          deployedAt: new Date(),
          returnedAt: null,
        },
      });

      await db.stockMovement.create({
        data: {
          tenantId,
          type: 'DEPLOY_OUT',
          productId: serial.productId,
          serialItemId: serial.id,
          fromLocationId: serial.locationId,
          toLocationId: null,
          quantity: 1,
          unitCost,
          totalCost: unitCost,
          popId: input.popId,
          notes: input.notes ?? null,
          createdById: actorUserId,
        },
      });

      return updated;
    };

    const result = tx ? await run(tx) : await this.prisma.$transaction(run);

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'stock.deploy',
      resource: 'serial_items',
      resourceId: result.id,
      afterState: {
        status: result.status,
        popId: result.popId,
        networkEquipmentId: result.networkEquipmentId,
      },
    });
    return result;
  }

  /**
   * Recolhe um bem da rede própria de volta pro estoque.
   * O operador precisa ter acesso de escrita no local de destino.
   */
  async returnToStock(
    tenantId: string,
    actorUserId: string,
    input: { serialItemId: string; toLocationId: string; notes?: string | null },
    options: { isAdmin?: boolean } = {},
    tx?: Prisma.TransactionClient,
  ) {
    if (!options.isAdmin) {
      await this.locations.assertCanWrite(tenantId, actorUserId, input.toLocationId);
    }

    const run = async (db: Prisma.TransactionClient) => {
      const serial = await db.serialItem.findFirst({
        where: { id: input.serialItemId, tenantId },
        select: {
          id: true,
          serial: true,
          assetTag: true,
          status: true,
          popId: true,
          productId: true,
          acquisitionCost: true,
        },
      });
      if (!serial) throw new NotFoundException('Patrimônio não encontrado');
      if (serial.status !== 'IN_USE') {
        throw new BadRequestException(
          `Patrimônio em status ${serial.status} não pode ser recolhido (esperado IN_USE)`,
        );
      }

      const location = await db.stockLocation.findFirst({
        where: { id: input.toLocationId, tenantId, deletedAt: null, isActive: true },
        select: { id: true },
      });
      if (!location) throw new NotFoundException('Local de destino não encontrado');

      const product = await db.product.findUnique({
        where: { id: serial.productId },
        select: { cost: true },
      });
      const unitCost = Number(serial.acquisitionCost ?? product?.cost ?? 0);

      const updated = await db.serialItem.update({
        where: { id: serial.id },
        data: {
          status: 'IN_STOCK',
          locationId: input.toLocationId,
          // Solta o vínculo: o equipamento da planta pode continuar existindo
          // (vai receber outro bem), mas ESTE bem não é mais ele.
          popId: null,
          networkEquipmentId: null,
          returnedAt: new Date(),
        },
      });

      await db.stockMovement.create({
        data: {
          tenantId,
          type: 'DEPLOY_RETURN',
          productId: serial.productId,
          serialItemId: serial.id,
          fromLocationId: null,
          toLocationId: input.toLocationId,
          quantity: 1,
          unitCost,
          totalCost: unitCost,
          // Preserva de ONDE veio, pro kardex contar a história completa.
          popId: serial.popId,
          notes: input.notes ?? null,
          createdById: actorUserId,
        },
      });

      return updated;
    };

    const result = tx ? await run(tx) : await this.prisma.$transaction(run);

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'stock.deploy_return',
      resource: 'serial_items',
      resourceId: result.id,
      afterState: { status: result.status, locationId: result.locationId },
    });
    return result;
  }
}
