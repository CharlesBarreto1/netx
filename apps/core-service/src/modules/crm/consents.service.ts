import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import type {
  ConsentPurpose,
  ConsentStatus,
  CustomerConsentResponse,
  ListConsentsQuery,
  RecordConsentRequest,
} from '@netx/shared';

import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

/**
 * Serviço de consentimentos LGPD/GDPR.
 * Cada chamada a `record` cria um NOVO registro (trilha imutável) em vez de
 * atualizar o último — isso preserva evidência histórica exigida por auditoria
 * regulatória. O estado "atual" é derivado do último registro por (purpose).
 */
@Injectable()
export class CustomerConsentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    tenantId: string,
    customerId: string,
    q: ListConsentsQuery,
  ): Promise<CustomerConsentResponse[]> {
    await this.assertCustomer(tenantId, customerId);

    const where: Prisma.CustomerConsentWhereInput = {
      tenantId,
      customerId,
      ...(q.purpose ? { purpose: q.purpose } : {}),
      ...(q.status ? { status: q.status } : {}),
    };

    const rows = await this.prisma.customerConsent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toConsentResponse);
  }

  async record(
    tenantId: string,
    actorUserId: string,
    customerId: string,
    input: RecordConsentRequest,
    source: { ip?: string | null; userAgent?: string | null },
  ): Promise<CustomerConsentResponse> {
    await this.assertCustomer(tenantId, customerId);

    const now = new Date();
    const row = await this.prisma.customerConsent.create({
      data: {
        tenantId,
        customerId,
        purpose: input.purpose,
        status: input.status,
        method: input.method,
        grantedAt: input.status === 'GRANTED' ? now : null,
        revokedAt: input.status === 'REVOKED' ? now : null,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        policyVersion: input.policyVersion ?? null,
        sourceIp: source.ip ?? null,
        sourceUserAgent: source.userAgent ?? null,
        evidenceUrl: input.evidenceUrl ?? null,
        notes: input.notes ?? null,
        metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'customer.consent.recorded',
      resource: 'customers',
      resourceId: customerId,
      afterState: {
        consentId: row.id,
        purpose: row.purpose,
        status: row.status,
        method: row.method,
      },
    });

    return toConsentResponse(row);
  }

  /**
   * Retorna o estado atual consolidado dos consentimentos do cliente:
   * último registro por (purpose).
   */
  async currentState(
    tenantId: string,
    customerId: string,
  ): Promise<Record<ConsentPurpose, ConsentStatus>> {
    await this.assertCustomer(tenantId, customerId);

    // Estratégia simples: pega tudo em ordem desc e reduz para o primeiro por purpose.
    // Para volumes grandes trocar por DISTINCT ON via $queryRaw.
    const rows = await this.prisma.customerConsent.findMany({
      where: { tenantId, customerId },
      orderBy: { createdAt: 'desc' },
      select: { purpose: true, status: true },
    });

    const state: Partial<Record<ConsentPurpose, ConsentStatus>> = {};
    for (const r of rows) {
      if (!state[r.purpose as ConsentPurpose]) {
        state[r.purpose as ConsentPurpose] = r.status as ConsentStatus;
      }
    }
    return state as Record<ConsentPurpose, ConsentStatus>;
  }

  private async assertCustomer(tenantId: string, customerId: string): Promise<void> {
    const c = await this.prisma.customer.findFirst({
      where: { id: customerId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!c) throw new NotFoundException('Cliente não encontrado');
  }
}

function toConsentResponse(c: {
  id: string;
  customerId: string;
  purpose: string;
  status: string;
  method: string;
  grantedAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date | null;
  policyVersion: string | null;
  sourceIp: string | null;
  sourceUserAgent: string | null;
  evidenceUrl: string | null;
  notes: string | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}): CustomerConsentResponse {
  return {
    id: c.id,
    customerId: c.customerId,
    purpose: c.purpose as CustomerConsentResponse['purpose'],
    status: c.status as CustomerConsentResponse['status'],
    method: c.method as CustomerConsentResponse['method'],
    grantedAt: c.grantedAt?.toISOString() ?? null,
    revokedAt: c.revokedAt?.toISOString() ?? null,
    expiresAt: c.expiresAt?.toISOString() ?? null,
    policyVersion: c.policyVersion,
    sourceIp: c.sourceIp,
    sourceUserAgent: c.sourceUserAgent,
    evidenceUrl: c.evidenceUrl,
    notes: c.notes,
    metadata: (c.metadata as Record<string, unknown> | null) ?? null,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}
