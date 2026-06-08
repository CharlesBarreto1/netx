import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, SerialStatus as PrismaSerialStatus } from '@prisma/client';

import {
  paginationMeta,
  type ChangeSerialStatusRequest,
  type ListSerialItemsQuery,
  type Paginated,
  type SerialHistoryEvent,
  type SerialHistoryResponse,
  type SerialItemResponse,
  type StockReportItem,
  type StockReportQuery,
  type StockReportResponse,
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

  /**
   * Relatório de estoque/patrimônio: agregados (total de unidades + valor de
   * compra, por produto e por status) + detalhe item a item, com a cidade do
   * cliente quando em comodato. Filtros: depósito, produto, status, cidade,
   * só-comodato, serial. Teto de linhas pra proteger memória.
   */
  async report(tenantId: string, q: StockReportQuery): Promise<StockReportResponse> {
    const CAP = 10_000;
    const where: Prisma.SerialItemWhereInput = {
      tenantId,
      ...(q.locationId ? { locationId: q.locationId } : {}),
      ...(q.productId ? { productId: q.productId } : {}),
      ...(q.onlyComodato ? { status: 'ALLOCATED' as PrismaSerialStatus } : {}),
      ...(q.status ? { status: q.status as PrismaSerialStatus } : {}),
      ...(q.search?.trim()
        ? { serial: { contains: q.search.trim(), mode: 'insensitive' } }
        : {}),
      ...(q.city?.trim()
        ? {
            contract: {
              customer: {
                addresses: {
                  some: { city: { contains: q.city.trim(), mode: 'insensitive' } },
                },
              },
            },
          }
        : {}),
      ...(q.acquiredFrom || q.acquiredTo
        ? {
            acquisitionDate: {
              ...(q.acquiredFrom ? { gte: parseDayStart(q.acquiredFrom) } : {}),
              ...(q.acquiredTo ? { lte: parseDayEnd(q.acquiredTo) } : {}),
            },
          }
        : {}),
    };

    const rows = await this.prisma.serialItem.findMany({
      where,
      take: CAP + 1,
      orderBy: [{ productId: 'asc' }, { serial: 'asc' }],
      include: {
        product: { select: { id: true, sku: true, name: true, cost: true } },
        location: { select: { name: true } },
        contract: {
          select: {
            code: true,
            customer: {
              select: {
                displayName: true,
                addresses: {
                  select: { city: true, type: true, isPrimary: true },
                },
              },
            },
          },
        },
      },
    });

    const truncated = rows.length > CAP;
    const data = truncated ? rows.slice(0, CAP) : rows;

    const items: StockReportItem[] = data.map((r) => {
      const purchaseValue = Number(r.acquisitionCost ?? r.product.cost ?? 0);
      return {
        id: r.id,
        serial: r.serial,
        status: r.status,
        productSku: r.product.sku,
        productName: r.product.name,
        locationName: r.location?.name ?? null,
        contractCode: r.contract?.code ?? null,
        customerName: r.contract?.customer?.displayName ?? null,
        city: pickCity(r.contract?.customer?.addresses ?? []),
        purchaseValue,
      };
    });

    // Agregados.
    const byProductMap = new Map<
      string,
      { productId: string; sku: string; name: string; units: number; purchaseValue: number }
    >();
    const byStatusMap = new Map<
      string,
      { status: StockReportItem['status']; units: number; purchaseValue: number }
    >();
    const byCityMap = new Map<
      string,
      { city: string | null; units: number; purchaseValue: number }
    >();
    let totalUnits = 0;
    let totalPurchaseValue = 0;

    for (let idx = 0; idx < data.length; idx++) {
      const r = data[idx];
      const value = Number(r.acquisitionCost ?? r.product.cost ?? 0);
      totalUnits += 1;
      totalPurchaseValue += value;

      const city = items[idx].city;
      const cityKey = city ?? '__none__';
      const c = byCityMap.get(cityKey) ?? { city, units: 0, purchaseValue: 0 };
      c.units += 1;
      c.purchaseValue += value;
      byCityMap.set(cityKey, c);

      const p = byProductMap.get(r.productId) ?? {
        productId: r.productId,
        sku: r.product.sku,
        name: r.product.name,
        units: 0,
        purchaseValue: 0,
      };
      p.units += 1;
      p.purchaseValue += value;
      byProductMap.set(r.productId, p);

      const s = byStatusMap.get(r.status) ?? {
        status: r.status,
        units: 0,
        purchaseValue: 0,
      };
      s.units += 1;
      s.purchaseValue += value;
      byStatusMap.set(r.status, s);
    }

    const round2 = (n: number) => Math.round(n * 100) / 100;

    return {
      summary: { totalUnits, totalPurchaseValue: round2(totalPurchaseValue) },
      byProduct: [...byProductMap.values()]
        .map((p) => ({ ...p, purchaseValue: round2(p.purchaseValue) }))
        .sort((a, b) => b.units - a.units),
      byStatus: [...byStatusMap.values()].map((s) => ({
        ...s,
        purchaseValue: round2(s.purchaseValue),
      })),
      byCity: [...byCityMap.values()]
        .map((c) => ({ ...c, purchaseValue: round2(c.purchaseValue) }))
        .sort((a, b) => b.units - a.units),
      items: items.map((i) => ({ ...i, purchaseValue: round2(i.purchaseValue) })),
      truncated,
    };
  }

  /**
   * Histórico (timeline) do equipamento a partir do kardex (StockMovement):
   * compra/NF, transferências, comodato, retorno, ajustes, baixa — com data e
   * usuário. Os pares TRANSFER_OUT+TRANSFER_IN viram um único evento "de X p/ Y".
   */
  async history(tenantId: string, serialId: string): Promise<SerialHistoryResponse> {
    const item = await this.prisma.serialItem.findFirst({
      where: { id: serialId, tenantId },
      select: { serial: true, status: true, product: { select: { sku: true, name: true } } },
    });
    if (!item) throw new NotFoundException('Patrimônio não encontrado');

    const movs = await this.prisma.stockMovement.findMany({
      where: { tenantId, serialItemId: serialId },
      orderBy: { createdAt: 'asc' },
      include: {
        createdBy: { select: { firstName: true, lastName: true, email: true } },
        fromLocation: { select: { name: true } },
        toLocation: { select: { name: true } },
        purchase: { select: { invoiceNumber: true, supplier: { select: { name: true } } } },
        contract: { select: { code: true, customer: { select: { displayName: true } } } },
      },
    });

    type MovRow = (typeof movs)[number];
    const toEvent = (
      m: MovRow,
      type: SerialHistoryEvent['type'],
      override?: { toLocation?: string | null },
    ): SerialHistoryEvent => ({
      id: m.id,
      type,
      date: m.createdAt.toISOString(),
      user: userName(m.createdBy),
      fromLocation: m.fromLocation?.name ?? null,
      toLocation: override?.toLocation ?? m.toLocation?.name ?? null,
      supplier: m.purchase?.supplier?.name ?? null,
      invoiceNumber: m.purchase?.invoiceNumber ?? null,
      contractCode: m.contract?.code ?? null,
      customerName: m.contract?.customer?.displayName ?? null,
      notes: m.notes ?? null,
    });

    const events: SerialHistoryEvent[] = [];
    let pendingOut: MovRow | null = null;
    for (const m of movs) {
      if (m.type === 'TRANSFER_OUT') {
        pendingOut = m;
        continue;
      }
      if (m.type === 'TRANSFER_IN' && pendingOut) {
        events.push(toEvent(pendingOut, 'TRANSFER', { toLocation: m.toLocation?.name ?? null }));
        pendingOut = null;
        continue;
      }
      events.push(toEvent(m, m.type as SerialHistoryEvent['type']));
    }
    if (pendingOut) events.push(toEvent(pendingOut, 'TRANSFER'));

    // Reordena por data (o pareamento pode ter deslocado a transferência).
    events.sort((a, b) => a.date.localeCompare(b.date));

    return {
      serial: item.serial,
      status: item.status,
      product: { sku: item.product.sku, name: item.product.name },
      events,
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

/** Nome legível do usuário (nome completo, fallback email). */
function userName(
  u: { firstName: string | null; lastName: string | null; email: string } | null,
): string | null {
  if (!u) return null;
  const full = `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim();
  return full || u.email;
}

/** Início do dia pra um YYYY-MM-DD (ou Date completa pra ISO). */
function parseDayStart(s: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00.000`) : new Date(s);
}
/** Fim do dia pra um YYYY-MM-DD (inclui o dia inteiro no lte). */
function parseDayEnd(s: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T23:59:59.999`) : new Date(s);
}

/** Cidade do cliente: prioriza endereço de serviço, depois primário, depois 1º. */
function pickCity(
  addresses: Array<{ city: string; type: string; isPrimary: boolean }>,
): string | null {
  if (addresses.length === 0) return null;
  const service = addresses.find((a) => a.type === 'SERVICE');
  if (service) return service.city;
  const primary = addresses.find((a) => a.isPrimary);
  return (primary ?? addresses[0]).city;
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
