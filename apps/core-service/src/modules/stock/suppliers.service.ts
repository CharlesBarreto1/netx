import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

import type {
  CreateSupplierRequest,
  UpdateSupplierRequest,
} from '@netx/shared';

@Injectable()
export class SuppliersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(tenantId: string, query?: { search?: string; isActive?: boolean }) {
    const where: Prisma.SupplierWhereInput = {
      tenantId,
      deletedAt: null,
      ...(query?.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query?.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { taxId: { contains: query.search, mode: 'insensitive' } },
              { email: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    return this.prisma.supplier.findMany({
      where,
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      take: 500,
    });
  }

  async findById(tenantId: string, id: string) {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!supplier) throw new NotFoundException('Fornecedor não encontrado');
    return supplier;
  }

  async create(
    tenantId: string,
    actorUserId: string,
    input: CreateSupplierRequest,
  ) {
    // Validação de duplicata por (taxId, taxIdType) — só se ambos preenchidos.
    // (taxId vazio é aceitável pra fornecedor informal/sem cadastro fiscal.)
    if (input.taxId && input.taxIdType) {
      const existing = await this.prisma.supplier.findFirst({
        where: {
          tenantId,
          taxId: input.taxId,
          taxIdType: input.taxIdType,
          deletedAt: null,
        },
      });
      if (existing) {
        throw new ConflictException(
          `Fornecedor com ${input.taxIdType} ${input.taxId} já existe`,
        );
      }
    }

    const supplier = await this.prisma.supplier.create({
      data: {
        tenantId,
        name: input.name,
        taxId: input.taxId ?? null,
        taxIdType: input.taxIdType ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        address: input.address ?? null,
        city: input.city ?? null,
        state: input.state ?? null,
        notes: input.notes ?? null,
        isActive: input.isActive,
      },
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'supplier.created',
      resource: 'suppliers',
      resourceId: supplier.id,
      afterState: { name: supplier.name, taxId: supplier.taxId },
    });

    return supplier;
  }

  async update(
    tenantId: string,
    actorUserId: string,
    id: string,
    input: UpdateSupplierRequest,
  ) {
    const before = await this.findById(tenantId, id);

    // Se vai mudar taxId/taxIdType, valida duplicata.
    if ((input.taxId || input.taxIdType) && input.taxId && input.taxIdType) {
      const conflict = await this.prisma.supplier.findFirst({
        where: {
          tenantId,
          taxId: input.taxId,
          taxIdType: input.taxIdType,
          deletedAt: null,
          NOT: { id },
        },
      });
      if (conflict) {
        throw new ConflictException(
          `Outro fornecedor já tem ${input.taxIdType} ${input.taxId}`,
        );
      }
    }

    const updated = await this.prisma.supplier.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.taxId !== undefined ? { taxId: input.taxId } : {}),
        ...(input.taxIdType !== undefined ? { taxIdType: input.taxIdType } : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.address !== undefined ? { address: input.address } : {}),
        ...(input.city !== undefined ? { city: input.city } : {}),
        ...(input.state !== undefined ? { state: input.state } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'supplier.updated',
      resource: 'suppliers',
      resourceId: id,
      beforeState: { name: before.name, isActive: before.isActive },
      afterState: { name: updated.name, isActive: updated.isActive },
    });

    return updated;
  }

  // Soft delete — não REMOVE pra preservar histórico de purchases.
  // O `deletedAt` + `isActive=false` somem da UI mas preservam FK em purchases.
  async remove(tenantId: string, actorUserId: string, id: string) {
    const before = await this.findById(tenantId, id);

    // Bloqueia delete se tem compras ativas (defesa adicional ao onDelete:Restrict).
    const purchaseCount = await this.prisma.purchase.count({
      where: { tenantId, supplierId: id },
    });
    if (purchaseCount > 0) {
      throw new ConflictException(
        `Fornecedor tem ${purchaseCount} compra(s) — desative ao invés de remover`,
      );
    }

    await this.prisma.supplier.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'supplier.deleted',
      resource: 'suppliers',
      resourceId: id,
      beforeState: { name: before.name },
    });
  }
}
