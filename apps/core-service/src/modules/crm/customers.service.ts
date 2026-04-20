import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, CustomerType as PrismaCustomerType } from '@prisma/client';

import {
  paginationMeta,
  validateDocument,
  isDocumentTypeSupported,
  UnsupportedDocumentTypeError,
  type Paginated,
  type CreateCustomerRequest,
  type UpdateCustomerRequest,
  type ListCustomersQuery,
  type CustomerResponse,
  type TaxId,
} from '@netx/shared';

import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { computeDisplayName, toCustomerResponse } from './customer.mapper';

/**
 * Regras principais:
 *   - Todo acesso é filtrado por tenantId (multi-tenancy estrito).
 *   - TaxId é validado sincronamente quando o par (país, tipo) tem validator.
 *     - Se inválido → 400.
 *     - Se tipo OTHER ou país sem validator → grava sem validar, sem verified.
 *   - Upsert idempotente por (tenantId, taxId, taxIdType) — não permite dois
 *     clientes ativos com o mesmo documento.
 *   - displayName é desnormalizado (PF = nome+sobrenome, PJ = fantasia||razão).
 *   - Soft-delete via deletedAt (soft + status=CHURNED).
 */
@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------------------
  // CREATE
  // ---------------------------------------------------------------------------
  async create(
    tenantId: string,
    actorUserId: string,
    input: CreateCustomerRequest,
  ): Promise<CustomerResponse> {
    const normalizedTaxId = this.validateAndNormalizeTaxId(input.taxId);

    // Check duplicate taxId
    if (normalizedTaxId) {
      const existing = await this.prisma.customer.findFirst({
        where: {
          tenantId,
          taxId: normalizedTaxId.value,
          taxIdType: normalizedTaxId.type,
          deletedAt: null,
        },
        select: { id: true, displayName: true },
      });
      if (existing) {
        throw new ConflictException(
          `Já existe cliente com este documento: ${existing.displayName} (id=${existing.id})`,
        );
      }
    }

    // Check duplicate code
    if (input.code) {
      const byCode = await this.prisma.customer.findFirst({
        where: { tenantId, code: input.code, deletedAt: null },
        select: { id: true },
      });
      if (byCode) throw new ConflictException(`Código "${input.code}" já em uso`);
    }

    const displayName = computeDisplayName({
      type: input.type,
      firstName: 'firstName' in input ? input.firstName : undefined,
      lastName: 'lastName' in input ? input.lastName : undefined,
      companyName: 'companyName' in input ? input.companyName : undefined,
      tradeName: 'tradeName' in input ? input.tradeName : undefined,
    });
    if (!displayName) {
      throw new BadRequestException('Não foi possível determinar o displayName do cliente');
    }

    const customer = await this.prisma.customer.create({
      data: {
        tenantId,
        code: input.code ?? null,
        type: input.type as PrismaCustomerType,
        status: input.status ?? 'LEAD',

        firstName: 'firstName' in input ? input.firstName : null,
        lastName: 'lastName' in input ? input.lastName : null,
        birthDate: 'birthDate' in input && input.birthDate ? new Date(input.birthDate) : null,
        gender: 'gender' in input ? input.gender ?? null : null,
        motherName: 'motherName' in input ? input.motherName ?? null : null,

        companyName: 'companyName' in input ? input.companyName : null,
        tradeName: 'tradeName' in input ? input.tradeName ?? null : null,
        foundedAt: 'foundedAt' in input && input.foundedAt ? new Date(input.foundedAt) : null,
        stateRegistration:
          'stateRegistration' in input ? input.stateRegistration ?? null : null,
        municipalRegistration:
          'municipalRegistration' in input ? input.municipalRegistration ?? null : null,

        displayName,
        taxId: normalizedTaxId?.value ?? null,
        taxIdType: normalizedTaxId?.type ?? null,
        taxIdCountry: normalizedTaxId?.country ?? null,
        taxIdVerifiedAt: normalizedTaxId?.verified ? new Date() : null,

        primaryEmail: input.primaryEmail ?? null,
        primaryPhone: input.primaryPhone ?? null,
        preferredLanguage: input.preferredLanguage ?? null,
        timezone: input.timezone ?? null,
        shortNote: input.shortNote ?? null,
        metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,

        createdById: actorUserId,
        updatedById: actorUserId,
      },
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'customer.created',
      resource: 'customers',
      resourceId: customer.id,
      afterState: { displayName, type: customer.type, taxId: customer.taxId },
    });

    return toCustomerResponse(customer);
  }

  // ---------------------------------------------------------------------------
  // LIST
  // ---------------------------------------------------------------------------
  async list(
    tenantId: string,
    q: ListCustomersQuery,
  ): Promise<Paginated<CustomerResponse>> {
    const where: Prisma.CustomerWhereInput = {
      tenantId,
      deletedAt: null,
      ...(q.status ? { status: q.status } : {}),
      ...(q.type ? { type: q.type as PrismaCustomerType } : {}),
      ...(q.taxIdType ? { taxIdType: q.taxIdType } : {}),
      ...(q.country ? { taxIdCountry: q.country } : {}),
      ...(q.createdFrom || q.createdTo
        ? {
            createdAt: {
              ...(q.createdFrom ? { gte: new Date(q.createdFrom) } : {}),
              ...(q.createdTo ? { lte: new Date(q.createdTo) } : {}),
            },
          }
        : {}),
      ...(q.tag
        ? { tagAssignments: { some: { tagId: q.tag } } }
        : {}),
      ...(q.search
        ? {
            OR: [
              { displayName: { contains: q.search, mode: 'insensitive' } },
              { primaryEmail: { contains: q.search, mode: 'insensitive' } },
              { primaryPhone: { contains: q.search } },
              { taxId: { contains: q.search.replace(/\D/g, '') } },
              { code: { contains: q.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        include: { tagAssignments: { include: { tag: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.customer.count({ where }),
    ]);

    return {
      data: rows.map(toCustomerResponse),
      pagination: paginationMeta(total, q.page, q.pageSize),
    };
  }

  // ---------------------------------------------------------------------------
  // FIND ONE
  // ---------------------------------------------------------------------------
  async findById(tenantId: string, id: string): Promise<CustomerResponse> {
    const row = await this.prisma.customer.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: { tagAssignments: { include: { tag: true } } },
    });
    if (!row) throw new NotFoundException('Cliente não encontrado');
    return toCustomerResponse(row);
  }

  // ---------------------------------------------------------------------------
  // UPDATE
  // ---------------------------------------------------------------------------
  async update(
    tenantId: string,
    actorUserId: string,
    id: string,
    input: UpdateCustomerRequest,
  ): Promise<CustomerResponse> {
    const before = await this.prisma.customer.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!before) throw new NotFoundException('Cliente não encontrado');

    const normalizedTaxId =
      input.taxId === undefined ? undefined : this.validateAndNormalizeTaxId(input.taxId);

    // Se está trocando taxId, verifica unicidade
    if (normalizedTaxId && normalizedTaxId.value !== before.taxId) {
      const clash = await this.prisma.customer.findFirst({
        where: {
          tenantId,
          taxId: normalizedTaxId.value,
          taxIdType: normalizedTaxId.type,
          deletedAt: null,
          NOT: { id },
        },
        select: { id: true },
      });
      if (clash) throw new ConflictException('Documento já pertence a outro cliente');
    }

    if (input.code && input.code !== before.code) {
      const byCode = await this.prisma.customer.findFirst({
        where: { tenantId, code: input.code, deletedAt: null, NOT: { id } },
        select: { id: true },
      });
      if (byCode) throw new ConflictException(`Código "${input.code}" já em uso`);
    }

    const mergedForDisplayName = {
      type: before.type as 'INDIVIDUAL' | 'COMPANY',
      firstName: input.firstName ?? before.firstName,
      lastName: input.lastName ?? before.lastName,
      companyName: input.companyName ?? before.companyName,
      tradeName: input.tradeName ?? before.tradeName,
    };

    const updated = await this.prisma.customer.update({
      where: { id },
      data: {
        code: input.code,
        status: input.status,

        firstName: input.firstName,
        lastName: input.lastName,
        birthDate:
          input.birthDate === undefined
            ? undefined
            : input.birthDate === null
              ? null
              : new Date(input.birthDate),
        gender: input.gender,
        motherName: input.motherName,

        companyName: input.companyName,
        tradeName: input.tradeName,
        foundedAt:
          input.foundedAt === undefined
            ? undefined
            : input.foundedAt === null
              ? null
              : new Date(input.foundedAt),
        stateRegistration: input.stateRegistration,
        municipalRegistration: input.municipalRegistration,

        displayName: computeDisplayName(mergedForDisplayName),
        ...(normalizedTaxId !== undefined
          ? {
              taxId: normalizedTaxId?.value ?? null,
              taxIdType: normalizedTaxId?.type ?? null,
              taxIdCountry: normalizedTaxId?.country ?? null,
              taxIdVerifiedAt: normalizedTaxId?.verified ? new Date() : null,
            }
          : {}),

        primaryEmail: input.primaryEmail,
        primaryPhone: input.primaryPhone,
        preferredLanguage: input.preferredLanguage,
        timezone: input.timezone,
        shortNote: input.shortNote,
        metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,

        updatedById: actorUserId,
      },
      include: { tagAssignments: { include: { tag: true } } },
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'customer.updated',
      resource: 'customers',
      resourceId: id,
      beforeState: { status: before.status, displayName: before.displayName },
      afterState: { status: updated.status, displayName: updated.displayName },
    });

    return toCustomerResponse(updated);
  }

  // ---------------------------------------------------------------------------
  // SOFT DELETE
  // ---------------------------------------------------------------------------
  async softDelete(tenantId: string, actorUserId: string, id: string): Promise<void> {
    const row = await this.prisma.customer.findFirst({ where: { id, tenantId, deletedAt: null } });
    if (!row) throw new NotFoundException('Cliente não encontrado');

    await this.prisma.customer.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'CHURNED', updatedById: actorUserId },
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'customer.deleted',
      resource: 'customers',
      resourceId: id,
    });
  }

  // ---------------------------------------------------------------------------
  // TAGS (assign/remove)
  // ---------------------------------------------------------------------------
  async assignTags(
    tenantId: string,
    actorUserId: string,
    customerId: string,
    tagIds: string[],
  ): Promise<void> {
    // valida cliente
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!customer) throw new NotFoundException('Cliente não encontrado');

    // valida tags pertencem ao tenant
    const tags = await this.prisma.customerTag.findMany({
      where: { id: { in: tagIds }, tenantId },
      select: { id: true },
    });
    if (tags.length !== tagIds.length) {
      throw new BadRequestException('Uma ou mais tags não existem neste tenant');
    }

    await this.prisma.customerTagAssignment.createMany({
      data: tagIds.map((tagId) => ({
        tenantId,
        customerId,
        tagId,
        assignedById: actorUserId,
      })),
      skipDuplicates: true,
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'customer.tags.assigned',
      resource: 'customers',
      resourceId: customerId,
      afterState: { tagIds },
    });
  }

  async removeTag(
    tenantId: string,
    actorUserId: string,
    customerId: string,
    tagId: string,
  ): Promise<void> {
    const deleted = await this.prisma.customerTagAssignment.deleteMany({
      where: { customerId, tagId, tenantId },
    });
    if (deleted.count === 0) {
      throw new NotFoundException('Tag não associada a este cliente');
    }
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'customer.tags.removed',
      resource: 'customers',
      resourceId: customerId,
      afterState: { tagId },
    });
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  private validateAndNormalizeTaxId(
    taxId: TaxId | null | undefined,
  ): { type: TaxId['type']; country: string; value: string; verified: boolean } | null {
    if (taxId == null) return null;

    // Se o país/tipo tem validator, exigimos documento válido.
    if (isDocumentTypeSupported(taxId.country, taxId.type)) {
      try {
        const result = validateDocument(taxId.country, taxId.type, taxId.value);
        if (!result.valid) {
          throw new BadRequestException(`Documento inválido: ${result.reason}`);
        }
        return {
          type: taxId.type,
          country: taxId.country.toUpperCase(),
          value: result.normalized,
          verified: true,
        };
      } catch (e) {
        if (e instanceof UnsupportedDocumentTypeError) {
          // cai no fluxo abaixo
        } else {
          throw e;
        }
      }
    }

    // Fallback — país/tipo sem validator: armazena sem verificação, normalizando só para dígitos quando possível.
    const cleaned = taxId.value.trim();
    if (cleaned.length === 0) return null;
    return {
      type: taxId.type,
      country: taxId.country.toUpperCase(),
      value: cleaned,
      verified: false,
    };
  }
}
