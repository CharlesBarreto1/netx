import type { Customer, CustomerTag, CustomerTagAssignment } from '@prisma/client';
import type { CustomerResponse } from '@netx/shared';

type CustomerWithTags = Customer & {
  tagAssignments?: Array<CustomerTagAssignment & { tag: CustomerTag }>;
};

/**
 * Projeta a entidade Prisma `Customer` no DTO de resposta da API.
 * Formata datas para ISO-8601 e inclui tags se carregadas.
 */
export function toCustomerResponse(c: CustomerWithTags): CustomerResponse {
  return {
    id: c.id,
    tenantId: c.tenantId,
    code: c.code,
    type: c.type as CustomerResponse['type'],
    status: c.status as CustomerResponse['status'],

    firstName: c.firstName,
    lastName: c.lastName,
    birthDate: c.birthDate ? c.birthDate.toISOString().slice(0, 10) : null,
    gender: c.gender,
    motherName: c.motherName,

    companyName: c.companyName,
    tradeName: c.tradeName,
    foundedAt: c.foundedAt ? c.foundedAt.toISOString().slice(0, 10) : null,
    stateRegistration: c.stateRegistration,
    municipalRegistration: c.municipalRegistration,

    displayName: c.displayName,
    taxId: c.taxId,
    taxIdType: c.taxIdType as CustomerResponse['taxIdType'],
    taxIdCountry: c.taxIdCountry,
    taxIdVerifiedAt: c.taxIdVerifiedAt?.toISOString() ?? null,
    primaryEmail: c.primaryEmail,
    primaryPhone: c.primaryPhone,
    preferredLanguage: c.preferredLanguage,
    timezone: c.timezone,
    shortNote: c.shortNote,
    metadata: (c.metadata as Record<string, unknown> | null) ?? null,

    tags: c.tagAssignments?.map((a) => ({
      id: a.tag.id,
      name: a.tag.name,
      color: a.tag.color,
    })),

    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    deletedAt: c.deletedAt?.toISOString() ?? null,
  };
}

/**
 * Calcula o displayName desnormalizado de um cliente para busca.
 */
export function computeDisplayName(input: {
  type: 'INDIVIDUAL' | 'COMPANY';
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  tradeName?: string | null;
}): string {
  if (input.type === 'INDIVIDUAL') {
    return [input.firstName, input.lastName].filter(Boolean).join(' ').trim();
  }
  return (input.tradeName || input.companyName || '').trim();
}
