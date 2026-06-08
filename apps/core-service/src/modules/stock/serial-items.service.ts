import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, SerialStatus as PrismaSerialStatus } from '@prisma/client';

import {
  paginationMeta,
  type ChangeSerialStatusRequest,
  type ListSerialItemsQuery,
  type Paginated,
  type SerialItemResponse,
} from '@netx/shared';

import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const SERIAL_INCLUDE = {
  product: { select: { id: true, sku: true, name: true, brand: true, model: true } },
  location: { select: { id: true, name: true } },
  contract: { select: { id: true, code: true } },
} as const;

type SerialRow = Prisma.SerialItemGetPayload<{ include: typeof SERIAL_INCLUDE }>;

/**
 * Gestão de patrimônios (SerialItem). Listagem com busca por serial e mudança
 * de status. Mudar pra status de saída (defeito/baixa/venda/inutilização)
 * descontabiliza o item (o saldo de PATRIMONIAL conta só IN_STOCK) e grava o
 * kardex; reativar (→ IN_STOCK) recontabiliza num local.
 */
@Injectable()
export class SerialItemsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    tenantId: string,
    q: ListSerialItemsQuery,
  ): Promise<Paginated<SerialItemResponse>> {
    const where: Prisma.SerialItemWhereInput = {
      tenantId,
      ...(q.status ? { status: q.status as PrismaSerialStatus } : {}),
      ...(q.productId ? { productId: q.productId } : {}),
      ...(q.locationId ? { locationId: q.locationId } : {}),
      ...(q.search?.trim()
        ? { serial: { contains: q.search.trim(), mode: 'insensitive' } }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.serialItem.findMany({
        where,
        orderBy: [{ status: 'asc' }, { serial: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: SERIAL_INCLUDE,
      }),
      this.prisma.serialItem.count({ where }),
    ]);
    return {
      data: rows.map(toResponse),
      pagination: paginationMeta(total, q.page, q.pageSize),
    };
  }

  async changeStatus(
    tenantId: string,
    actorUserId: string,
    id: string,
    input: ChangeSerialStatusRequest,
  ): Promise<SerialItemResponse> {
    const item = await this.prisma.serialItem.findFirst({
      where: { id, tenantId },
      include: { product: { select: { id: true, sku: true, cost: true } } },
    });
    if (!item) throw new NotFoundException('Patrimônio não encontrado');

    const target = input.status as PrismaSerialStatus;
    if (item.status === target) {
      throw new BadRequestException('O item já está nesse status.');
    }
    // Comodato ativo: devolver primeiro (mantém a contabilidade do contrato).
    if (item.status === 'ALLOCATED') {
      throw new BadRequestException(
        'Item em comodato com cliente — devolva o comodato antes de mudar o status.',
      );
    }

    const reasonNote = input.reason?.trim() || null;
    const unitCost = Number(item.acquisitionCost ?? item.product.cost ?? 0);
    const wasInStock = item.status === 'IN_STOCK' || item.status === 'IN_TRANSIT';

    const updated = await this.prisma.$transaction(async (tx) => {
      if (target === 'IN_STOCK') {
        // Reativar — recontabiliza num local (ajuste de entrada no kardex).
        await tx.stockMovement.create({
          data: {
            tenantId,
            type: 'ADJUSTMENT_IN',
            productId: item.productId,
            serialItemId: item.id,
            toLocationId: input.locationId!,
            quantity: 1,
            unitCost,
            totalCost: unitCost,
            notes: `Reativação${reasonNote ? ` — ${reasonNote}` : ''}`,
            createdById: actorUserId,
          },
        });
        return tx.serialItem.update({
          where: { id: item.id },
          data: {
            status: 'IN_STOCK',
            locationId: input.locationId!,
            ...(reasonNote ? { notes: reasonNote } : {}),
          },
          include: SERIAL_INCLUDE,
        });
      }

      // Status de saída. Só gera movimento se o item ESTAVA contabilizado;
      // reclassificar (ex.: DEFECTIVE→WRITTEN_OFF) não mexe no saldo.
      if (wasInStock) {
        await tx.stockMovement.create({
          data: {
            tenantId,
            type: target === 'SOLD' ? 'SALE' : 'ADJUSTMENT_OUT',
            productId: item.productId,
            serialItemId: item.id,
            fromLocationId: item.locationId,
            quantity: 1,
            unitCost,
            totalCost: unitCost,
            notes: `${target}${reasonNote ? ` — ${reasonNote}` : ''}`,
            createdById: actorUserId,
          },
        });
      }
      return tx.serialItem.update({
        where: { id: item.id },
        data: {
          status: target,
          locationId: null,
          ...(reasonNote ? { notes: reasonNote } : {}),
        },
        include: SERIAL_INCLUDE,
      });
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'stock.serial.status_changed',
      resource: 'serial_items',
      resourceId: id,
      beforeState: { status: item.status, serial: item.serial },
      afterState: { status: target, reason: reasonNote },
    });

    return toResponse(updated);
  }
}

function toResponse(r: SerialRow): SerialItemResponse {
  return {
    id: r.id,
    serial: r.serial,
    status: r.status,
    product: {
      id: r.product.id,
      sku: r.product.sku,
      name: r.product.name,
      brand: r.product.brand,
      model: r.product.model,
    },
    location: r.location ? { id: r.location.id, name: r.location.name } : null,
    contract: r.contract ? { id: r.contract.id, code: r.contract.code } : null,
    acquisitionCost: r.acquisitionCost != null ? String(r.acquisitionCost) : null,
    acquisitionDate: r.acquisitionDate?.toISOString() ?? null,
    notes: r.notes,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}
