import { randomInt } from 'node:crypto';

import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { NexusOperator } from '@prisma/client';

import { AuditService } from '../../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';

/** Projeção pública de um operador (com dados do usuário do NetX). */
export interface NexusOperatorDto {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  phoneE164: string | null;
  status: NexusOperator['status'];
  /** Só volta enquanto PENDING — o admin mostra ao operador p/ ele parear. */
  pairCode: string | null;
  pairedAt: string | null;
  lastSeenAt: string | null;
  createdAt: string;
}

/** Normaliza um telefone p/ E164 só-dígitos com "+". Vazio → null. */
export function normalizePhone(raw: string | null | undefined): string | null {
  const d = (raw ?? '').replace(/\D/g, '');
  return d ? `+${d}` : null;
}

/** Extrai um código de pareamento de 6 dígitos de um texto livre. */
function extractPairCode(text: string): string | null {
  const digits = (text ?? '').replace(/\D/g, '');
  // Aceita "NEXUS-123456", "123456", "codigo 123456" → pega os 6 dígitos.
  const m = /(\d{6})/.exec(digits.length === 6 ? digits : text ?? '');
  return m ? m[1] : null;
}

/**
 * NexusOperatorsService — allowlist da linha NEXUS (quem pode falar com o
 * copiloto via WhatsApp). Fluxo de PAREAMENTO:
 *   1. Admin adiciona um usuário → cria operador PENDING com `pairCode`.
 *   2. O operador envia o código para o número da Nexus.
 *   3. `tryPair` confirma o telefone real e ativa (ACTIVE).
 * Só operadores ACTIVE recebem resposta — é a fronteira de segurança.
 */
@Injectable()
export class NexusOperatorsService {
  private readonly logger = new Logger(NexusOperatorsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(tenantId: string): Promise<NexusOperatorDto[]> {
    const rows = await this.prisma.nexusOperator.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { firstName: true, lastName: true, email: true } } },
    });
    return rows.map((r) => this.toDto(r));
  }

  /** Adiciona um operador (PENDING) e gera o código de pareamento. */
  async add(tenantId: string, actorUserId: string, userId: string): Promise<NexusOperatorDto> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId, deletedAt: null },
      select: { id: true, firstName: true, lastName: true, email: true },
    });
    if (!user) throw new NotFoundException('Usuário não encontrado neste provedor');

    const existing = await this.prisma.nexusOperator.findUnique({
      where: { tenantId_userId: { tenantId, userId } },
    });
    if (existing) {
      throw new BadRequestException('Este usuário já é um operador da Nexus');
    }

    const pairCode = await this.uniquePairCode(tenantId);
    const row = await this.prisma.nexusOperator.create({
      data: { tenantId, userId, status: 'PENDING', pairCode },
      include: { user: { select: { firstName: true, lastName: true, email: true } } },
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'whatsapp.nexus.operator.add',
      resource: 'nexus_operator',
      resourceId: row.id,
      metadata: { operatorUserId: userId },
    });
    return this.toDto(row);
  }

  /** Gera um novo código (operador PENDING que perdeu/expirou o anterior). */
  async regenerateCode(tenantId: string, actorUserId: string, id: string): Promise<NexusOperatorDto> {
    const op = await this.prisma.nexusOperator.findFirst({ where: { id, tenantId } });
    if (!op) throw new NotFoundException('Operador não encontrado');
    if (op.status === 'ACTIVE') {
      throw new BadRequestException('Operador já pareado — remova e adicione de novo para trocar o número');
    }
    const pairCode = await this.uniquePairCode(tenantId);
    const row = await this.prisma.nexusOperator.update({
      where: { id: op.id },
      data: { pairCode, status: 'PENDING', phoneE164: null },
      include: { user: { select: { firstName: true, lastName: true, email: true } } },
    });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'whatsapp.nexus.operator.regen',
      resource: 'nexus_operator',
      resourceId: id,
    });
    return this.toDto(row);
  }

  /** Remove o operador (libera o número e o vínculo p/ re-cadastro). */
  async remove(tenantId: string, actorUserId: string, id: string): Promise<void> {
    const op = await this.prisma.nexusOperator.findFirst({ where: { id, tenantId } });
    if (!op) throw new NotFoundException('Operador não encontrado');
    await this.prisma.nexusOperator.delete({ where: { id: op.id } });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'whatsapp.nexus.operator.remove',
      resource: 'nexus_operator',
      resourceId: id,
      metadata: { operatorUserId: op.userId },
    });
  }

  // ---- usado pelo NexusWhatsappService (inbound) ----

  /** Operador ATIVO por telefone (a autorização em si). */
  async resolveActiveByPhone(tenantId: string, phoneE164: string | null) {
    const phone = normalizePhone(phoneE164);
    if (!phone) return null;
    return this.prisma.nexusOperator.findFirst({
      where: { tenantId, phoneE164: phone, status: 'ACTIVE' },
      include: { user: { select: { firstName: true, lastName: true } } },
    });
  }

  /**
   * Tenta parear: se o texto contém um código de um operador PENDING deste
   * tenant, vincula o telefone e ativa. Devolve o operador recém-ativado (com
   * o nome do usuário) ou null se não pareou.
   */
  async tryPair(tenantId: string, phoneE164: string | null, text: string) {
    const phone = normalizePhone(phoneE164);
    const code = extractPairCode(text);
    if (!phone || !code) return null;

    const pending = await this.prisma.nexusOperator.findFirst({
      where: { tenantId, status: 'PENDING', pairCode: code },
    });
    if (!pending) return null;

    // Número já vinculado a outro operador? (unique [tenant, phone]) — aborta
    // limpo pra não estourar o constraint.
    const taken = await this.prisma.nexusOperator.findFirst({
      where: { tenantId, phoneE164: phone, NOT: { id: pending.id } },
    });
    if (taken) {
      this.logger.warn(`Pareamento Nexus: número já vinculado a outro operador (tenant ${tenantId})`);
      return null;
    }

    const row = await this.prisma.nexusOperator.update({
      where: { id: pending.id },
      data: { phoneE164: phone, status: 'ACTIVE', pairCode: null, pairedAt: new Date() },
      include: { user: { select: { firstName: true, lastName: true } } },
    });
    await this.audit.log({
      tenantId,
      userId: pending.userId,
      action: 'whatsapp.nexus.operator.paired',
      resource: 'nexus_operator',
      resourceId: pending.id,
    });
    return row;
  }

  async touchLastSeen(id: string): Promise<void> {
    await this.prisma.nexusOperator
      .update({ where: { id }, data: { lastSeenAt: new Date() } })
      .catch(() => undefined);
  }

  // ---- helpers ----

  private async uniquePairCode(tenantId: string): Promise<string> {
    for (let i = 0; i < 8; i++) {
      const code = String(randomInt(100000, 1000000)); // sempre 6 dígitos
      const clash = await this.prisma.nexusOperator.findFirst({
        where: { tenantId, status: 'PENDING', pairCode: code },
        select: { id: true },
      });
      if (!clash) return code;
    }
    // Improvável: fallback ainda de 6 dígitos.
    return String(randomInt(100000, 1000000));
  }

  private toDto(
    r: NexusOperator & { user: { firstName: string; lastName: string; email: string } },
  ): NexusOperatorDto {
    return {
      id: r.id,
      userId: r.userId,
      userName: `${r.user.firstName} ${r.user.lastName}`.trim(),
      userEmail: r.user.email,
      phoneE164: r.phoneE164,
      status: r.status,
      pairCode: r.status === 'PENDING' ? r.pairCode : null,
      pairedAt: r.pairedAt ? r.pairedAt.toISOString() : null,
      lastSeenAt: r.lastSeenAt ? r.lastSeenAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
    };
  }
}
