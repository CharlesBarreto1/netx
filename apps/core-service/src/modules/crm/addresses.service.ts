import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import type {
  CreateCustomerAddressRequest,
  CustomerAddressResponse,
  UpdateCustomerAddressRequest,
} from '@netx/shared';

import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class CustomerAddressesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(tenantId: string, customerId: string): Promise<CustomerAddressResponse[]> {
    await this.assertCustomer(tenantId, customerId);
    const rows = await this.prisma.customerAddress.findMany({
      where: { tenantId, customerId },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    });
    return rows.map(toAddressResponse);
  }

  async create(
    tenantId: string,
    actorUserId: string,
    customerId: string,
    input: CreateCustomerAddressRequest,
  ): Promise<CustomerAddressResponse> {
    await this.assertCustomer(tenantId, customerId);

    // Se isPrimary=true, desmarca o anterior para manter invariante de 1 primário.
    const row = await this.prisma.$transaction(async (tx) => {
      if (input.isPrimary) {
        await tx.customerAddress.updateMany({
          where: { tenantId, customerId, isPrimary: true },
          data: { isPrimary: false },
        });
      }
      return tx.customerAddress.create({
        data: {
          tenantId,
          customerId,
          type: input.type,
          label: input.label ?? null,
          country: input.country,
          state: input.state ?? null,
          city: input.city,
          district: input.district ?? null,
          street: input.street,
          number: input.number ?? null,
          complement: input.complement ?? null,
          postalCode: input.postalCode ?? null,
          latitude: input.latitude != null ? new Prisma.Decimal(input.latitude) : null,
          longitude: input.longitude != null ? new Prisma.Decimal(input.longitude) : null,
          isPrimary: input.isPrimary,
        },
      });
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'customer.address.created',
      resource: 'customers',
      resourceId: customerId,
      afterState: { addressId: row.id, type: row.type, city: row.city },
    });

    return toAddressResponse(row);
  }

  async update(
    tenantId: string,
    actorUserId: string,
    customerId: string,
    addressId: string,
    input: UpdateCustomerAddressRequest,
  ): Promise<CustomerAddressResponse> {
    const before = await this.prisma.customerAddress.findFirst({
      where: { id: addressId, tenantId, customerId },
    });
    if (!before) throw new NotFoundException('Endereço não encontrado');

    const row = await this.prisma.$transaction(async (tx) => {
      if (input.isPrimary === true && !before.isPrimary) {
        await tx.customerAddress.updateMany({
          where: { tenantId, customerId, isPrimary: true, NOT: { id: addressId } },
          data: { isPrimary: false },
        });
      }
      return tx.customerAddress.update({
        where: { id: addressId },
        data: {
          type: input.type,
          label: input.label,
          country: input.country,
          state: input.state,
          city: input.city,
          district: input.district,
          street: input.street,
          number: input.number,
          complement: input.complement,
          postalCode: input.postalCode,
          latitude:
            input.latitude === undefined
              ? undefined
              : input.latitude === null
                ? null
                : new Prisma.Decimal(input.latitude),
          longitude:
            input.longitude === undefined
              ? undefined
              : input.longitude === null
                ? null
                : new Prisma.Decimal(input.longitude),
          isPrimary: input.isPrimary,
        },
      });
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'customer.address.updated',
      resource: 'customers',
      resourceId: customerId,
      afterState: { addressId, city: row.city },
    });

    return toAddressResponse(row);
  }

  async remove(
    tenantId: string,
    actorUserId: string,
    customerId: string,
    addressId: string,
  ): Promise<void> {
    const { count } = await this.prisma.customerAddress.deleteMany({
      where: { id: addressId, tenantId, customerId },
    });
    if (count === 0) throw new NotFoundException('Endereço não encontrado');

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'customer.address.deleted',
      resource: 'customers',
      resourceId: customerId,
      afterState: { addressId },
    });
  }

  private async assertCustomer(tenantId: string, customerId: string): Promise<void> {
    const c = await this.prisma.customer.findFirst({
      where: { id: customerId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!c) throw new NotFoundException('Cliente não encontrado');
  }
}

function toAddressResponse(a: {
  id: string;
  customerId: string;
  type: string;
  label: string | null;
  country: string;
  state: string | null;
  city: string;
  district: string | null;
  street: string;
  number: string | null;
  complement: string | null;
  postalCode: string | null;
  latitude: Prisma.Decimal | null;
  longitude: Prisma.Decimal | null;
  isPrimary: boolean;
  createdAt: Date;
  updatedAt: Date;
}): CustomerAddressResponse {
  return {
    id: a.id,
    customerId: a.customerId,
    type: a.type as CustomerAddressResponse['type'],
    label: a.label,
    country: a.country,
    state: a.state,
    city: a.city,
    district: a.district,
    street: a.street,
    number: a.number,
    complement: a.complement,
    postalCode: a.postalCode,
    latitude: a.latitude ? Number(a.latitude) : null,
    longitude: a.longitude ? Number(a.longitude) : null,
    isPrimary: a.isPrimary,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}
