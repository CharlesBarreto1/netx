import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import type {
  CreateCustomerContactRequest,
  CustomerContactResponse,
  UpdateCustomerContactRequest,
} from '@netx/shared';

import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class CustomerContactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(tenantId: string, customerId: string): Promise<CustomerContactResponse[]> {
    await this.assertCustomer(tenantId, customerId);
    const rows = await this.prisma.customerContact.findMany({
      where: { tenantId, customerId },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    });
    return rows.map(toContactResponse);
  }

  async create(
    tenantId: string,
    actorUserId: string,
    customerId: string,
    input: CreateCustomerContactRequest,
  ): Promise<CustomerContactResponse> {
    await this.assertCustomer(tenantId, customerId);
    const normalized = normalizeContactValue(input.type, input.value);

    try {
      const row = await this.prisma.$transaction(async (tx) => {
        if (input.isPrimary) {
          await tx.customerContact.updateMany({
            where: { tenantId, customerId, type: input.type, isPrimary: true },
            data: { isPrimary: false },
          });
        }
        return tx.customerContact.create({
          data: {
            tenantId,
            customerId,
            type: input.type,
            label: input.label ?? null,
            value: normalized,
            isPrimary: input.isPrimary,
            optIn: input.optIn,
          },
        });
      });

      await this.audit.log({
        tenantId,
        userId: actorUserId,
        action: 'customer.contact.created',
        resource: 'customers',
        resourceId: customerId,
        afterState: { contactId: row.id, type: row.type },
      });

      return toContactResponse(row);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Cliente já possui este contato');
      }
      throw e;
    }
  }

  async update(
    tenantId: string,
    actorUserId: string,
    customerId: string,
    contactId: string,
    input: UpdateCustomerContactRequest,
  ): Promise<CustomerContactResponse> {
    const before = await this.prisma.customerContact.findFirst({
      where: { id: contactId, tenantId, customerId },
    });
    if (!before) throw new NotFoundException('Contato não encontrado');

    const newValue =
      input.value !== undefined
        ? normalizeContactValue(input.type ?? before.type, input.value)
        : undefined;

    try {
      const row = await this.prisma.$transaction(async (tx) => {
        if (input.isPrimary === true && !before.isPrimary) {
          await tx.customerContact.updateMany({
            where: {
              tenantId,
              customerId,
              type: input.type ?? before.type,
              isPrimary: true,
              NOT: { id: contactId },
            },
            data: { isPrimary: false },
          });
        }
        return tx.customerContact.update({
          where: { id: contactId },
          data: {
            type: input.type,
            label: input.label,
            value: newValue,
            isPrimary: input.isPrimary,
            optIn: input.optIn,
          },
        });
      });

      await this.audit.log({
        tenantId,
        userId: actorUserId,
        action: 'customer.contact.updated',
        resource: 'customers',
        resourceId: customerId,
        afterState: { contactId, type: row.type },
      });

      return toContactResponse(row);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Outro contato já usa este valor');
      }
      throw e;
    }
  }

  async remove(
    tenantId: string,
    actorUserId: string,
    customerId: string,
    contactId: string,
  ): Promise<void> {
    const { count } = await this.prisma.customerContact.deleteMany({
      where: { id: contactId, tenantId, customerId },
    });
    if (count === 0) throw new NotFoundException('Contato não encontrado');

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'customer.contact.deleted',
      resource: 'customers',
      resourceId: customerId,
      afterState: { contactId },
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

/**
 * Normaliza valores de contato:
 *   - EMAIL → lowercase + trim
 *   - PHONE/MOBILE/WHATSAPP → strip de tudo que não é dígito ou '+', mantendo prefixo internacional.
 *   - TELEGRAM → trim, remove '@' inicial
 */
function normalizeContactValue(type: string, value: string): string {
  const v = value.trim();
  switch (type) {
    case 'EMAIL':
      return v.toLowerCase();
    case 'PHONE':
    case 'MOBILE':
    case 'WHATSAPP': {
      const cleaned = v.replace(/[^\d+]/g, '');
      // Garante apenas um '+' no início
      if (cleaned.startsWith('+')) {
        return '+' + cleaned.slice(1).replace(/\+/g, '');
      }
      return cleaned.replace(/\+/g, '');
    }
    case 'TELEGRAM':
      return v.replace(/^@+/, '');
    default:
      return v;
  }
}

function toContactResponse(c: {
  id: string;
  customerId: string;
  type: string;
  label: string | null;
  value: string;
  isPrimary: boolean;
  isVerified: boolean;
  optIn: boolean;
  createdAt: Date;
  updatedAt: Date;
}): CustomerContactResponse {
  return {
    id: c.id,
    customerId: c.customerId,
    type: c.type as CustomerContactResponse['type'],
    label: c.label,
    value: c.value,
    isPrimary: c.isPrimary,
    isVerified: c.isVerified,
    optIn: c.optIn,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}
