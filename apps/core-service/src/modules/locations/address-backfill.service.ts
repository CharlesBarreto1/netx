import { Injectable } from '@nestjs/common';

import {
  paginationMeta,
  type AddressBackfillItem,
  type AddressBackfillQuery,
  type Paginated,
} from '@netx/shared';

import { PrismaService } from '../prisma/prisma.service';
import { assertBrTenant } from './br-tenant.util';

@Injectable()
export class AddressBackfillService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lista contratos BR ainda em texto livre (streetId null) pra reconciliação
   * manual. Cada item traz CEP/número extraídos por heurística da string, só
   * pra pré-preencher o formulário — a vinculação real é o PATCH do contrato
   * (que denormaliza). Não muda nada aqui.
   */
  async listPending(
    tenantId: string,
    query: AddressBackfillQuery,
  ): Promise<Paginated<AddressBackfillItem>> {
    await assertBrTenant(this.prisma, tenantId);

    const where = { tenantId, streetId: null, deletedAt: null };
    const skip = (query.page - 1) * query.pageSize;

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.contract.findMany({
        where,
        select: {
          id: true,
          code: true,
          installationAddress: true,
          customer: { select: { displayName: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: query.pageSize,
      }),
      this.prisma.contract.count({ where }),
    ]);

    return {
      data: rows.map((c) => ({
        contractId: c.id,
        contractCode: c.code,
        customerName: c.customer?.displayName ?? '—',
        installationAddress: c.installationAddress,
        suggestedCep: extractCep(c.installationAddress),
        suggestedNumber: extractNumber(c.installationAddress),
      })),
      pagination: paginationMeta(total, query.page, query.pageSize),
    };
  }
}

/** Extrai um CEP (8 dígitos) da string livre, se houver. */
export function extractCep(text: string): string | null {
  const m = text.match(/(\d{5})-?(\d{3})/);
  return m ? `${m[1]}${m[2]}` : null;
}

/**
 * Tenta extrair o número do endereço por heurística. Preferência:
 *   1. "nº 123" / "n. 123" / "n 123"
 *   2. ", 123" (número logo após a vírgula do logradouro)
 * Ignora sequências de CEP (8 dígitos) e números muito longos.
 */
export function extractNumber(text: string): string | null {
  const withoutCep = text.replace(/\d{5}-?\d{3}/g, ' ');
  const byLabel = withoutCep.match(/\bn[º°o.]?\s*(\d{1,6})\b/i);
  if (byLabel) return byLabel[1];
  const byComma = withoutCep.match(/,\s*(\d{1,6})\b/);
  if (byComma) return byComma[1];
  return null;
}
