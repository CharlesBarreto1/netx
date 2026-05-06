/**
 * Portal — queries read-only do cliente sobre os próprios dados.
 * Sempre filtramos por (tenantId, customerId) — o token do portal já amarra
 * essas duas dimensões; aqui é defesa em profundidade.
 */
import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PortalService {
  constructor(private readonly prisma: PrismaService) {}

  async getMe(tenantId: string, customerId: string) {
    const c = await this.prisma.customer.findFirst({
      where: { id: customerId, tenantId, deletedAt: null },
      select: {
        id: true,
        code: true,
        type: true,
        displayName: true,
        firstName: true,
        lastName: true,
        companyName: true,
        tradeName: true,
        taxId: true,
        taxIdType: true,
        primaryEmail: true,
        primaryPhone: true,
        preferredLanguage: true,
        timezone: true,
        portalLastLoginAt: true,
        addresses: {
          where: { type: { in: ['SERVICE', 'BILLING'] } },
          select: {
            id: true,
            type: true,
            country: true,
            state: true,
            city: true,
            district: true,
            street: true,
            number: true,
            complement: true,
            isPrimary: true,
          },
        },
      },
    });
    if (!c) throw new NotFoundException();
    return c;
  }

  async getContracts(tenantId: string, customerId: string) {
    return this.prisma.contract.findMany({
      where: { tenantId, customerId, deletedAt: null },
      select: {
        id: true,
        code: true,
        authMethod: true,
        // PPPoE username pode ser útil pro cliente (config manual de roteador
        // num cenário híbrido); senha NUNCA aparece aqui.
        pppoeUsername: true,
        bandwidthMbps: true,
        monthlyValue: true,
        dueDay: true,
        status: true,
        installationAddress: true,
        activatedAt: true,
        suspendedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getInvoices(tenantId: string, customerId: string) {
    // Busca faturas dos contratos do cliente. Inclui mensalidades + cobranças
    // avulsas pra dar visão financeira completa.
    const [invoices, charges] = await Promise.all([
      this.prisma.contractInvoice.findMany({
        where: {
          tenantId,
          contract: { customerId, tenantId },
        },
        select: {
          id: true,
          amount: true,
          dueDate: true,
          status: true,
          paidAt: true,
          paidAmount: true,
          reference: true,
          contract: { select: { id: true, code: true } },
        },
        orderBy: { dueDate: 'desc' },
        take: 100,
      }),
      this.prisma.oneTimeCharge.findMany({
        where: { tenantId, customerId, deletedAt: null },
        select: {
          id: true,
          code: true,
          description: true,
          amount: true,
          dueDate: true,
          status: true,
          paidAt: true,
          paidAmount: true,
        },
        orderBy: { dueDate: 'desc' },
        take: 50,
      }),
    ]);
    return {
      invoices: invoices.map((i) => ({
        kind: 'INVOICE' as const,
        id: i.id,
        code: i.contract?.code ?? null,
        description: i.reference ?? 'Mensualidad',
        amount: Number(i.amount),
        paidAmount: i.paidAmount ? Number(i.paidAmount) : null,
        dueDate: i.dueDate.toISOString(),
        status: i.status,
        paidAt: i.paidAt?.toISOString() ?? null,
      })),
      charges: charges.map((c) => ({
        kind: 'CHARGE' as const,
        id: c.id,
        code: c.code,
        description: c.description,
        amount: Number(c.amount),
        paidAmount: c.paidAmount ? Number(c.paidAmount) : null,
        dueDate: c.dueDate.toISOString(),
        status: c.status,
        paidAt: c.paidAt?.toISOString() ?? null,
      })),
    };
  }
}
