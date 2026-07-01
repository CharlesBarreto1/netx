import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

/** Categorias sugeridas (o front rotula/agrupa). Livre — VARCHAR no banco. */
export const QUICK_REPLY_CATEGORIES = [
  'saudacao',
  'encerramento',
  'viabilidade',
  'planos',
  'prazos',
  'geral',
] as const;

export interface QuickReplyInput {
  /** 'shared' = biblioteca da equipe (exige chat.admin); 'personal' = do operador. */
  scope: 'shared' | 'personal';
  category: string;
  title: string;
  body: string;
  shortcut?: string | null;
  sortOrder?: number;
}

/**
 * Respostas rápidas (mensagens predefinidas) do atendimento.
 *
 * Dois escopos coexistem:
 *   - COMPARTILHADA (ownerUserId = null) — biblioteca-padrão da empresa
 *     (saudações, negativa de viabilidade, planos, prazos). CRUD exige
 *     chat.admin; todos os operadores leem/usam.
 *   - PESSOAL (ownerUserId = operador) — respostas do próprio atendente.
 *     CRUD livre pra quem tem chat.send, restrito ao dono.
 *
 * A interpolação de {cliente}/{operador} acontece no front, na hora de
 * inserir no compositor (lá temos os nomes em mãos).
 */
@Injectable()
export class WhatsappQuickRepliesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Lista as respostas visíveis pro operador: compartilhadas + as dele. */
  async list(tenantId: string, userId: string) {
    return this.prisma.whatsappQuickReply.findMany({
      where: { tenantId, OR: [{ ownerUserId: null }, { ownerUserId: userId }] },
      orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }, { title: 'asc' }],
    });
  }

  async create(
    tenantId: string,
    userId: string,
    canManageShared: boolean,
    input: QuickReplyInput,
  ) {
    this.assertScope(input.scope, canManageShared);
    this.validateBody(input);
    return this.prisma.whatsappQuickReply.create({
      data: {
        tenantId,
        ownerUserId: input.scope === 'shared' ? null : userId,
        category: input.category.trim() || 'geral',
        title: input.title.trim(),
        body: input.body.trim(),
        shortcut: input.shortcut?.trim() || null,
        sortOrder: input.sortOrder ?? 0,
        createdById: userId,
      },
    });
  }

  async update(
    tenantId: string,
    userId: string,
    canManageShared: boolean,
    id: string,
    input: Partial<QuickReplyInput>,
  ) {
    const existing = await this.loadEditable(tenantId, userId, canManageShared, id);

    // Trocar de escopo (pessoal <-> compartilhada) é permitido, respeitando o gate.
    let ownerUserId = existing.ownerUserId;
    if (input.scope) {
      this.assertScope(input.scope, canManageShared);
      ownerUserId = input.scope === 'shared' ? null : userId;
    }
    if (input.title !== undefined || input.body !== undefined) {
      this.validateBody({
        title: input.title ?? existing.title,
        body: input.body ?? existing.body,
      });
    }

    const data: Prisma.WhatsappQuickReplyUncheckedUpdateInput = { ownerUserId: ownerUserId ?? null };
    if (input.category !== undefined) data.category = input.category.trim() || 'geral';
    if (input.title !== undefined) data.title = input.title.trim();
    if (input.body !== undefined) data.body = input.body.trim();
    if (input.shortcut !== undefined) data.shortcut = input.shortcut?.trim() || null;
    if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;

    return this.prisma.whatsappQuickReply.update({ where: { id }, data });
  }

  async remove(tenantId: string, userId: string, canManageShared: boolean, id: string) {
    await this.loadEditable(tenantId, userId, canManageShared, id);
    await this.prisma.whatsappQuickReply.delete({ where: { id } });
    return { ok: true };
  }

  /** Carrega a resposta e valida que o ator pode editá-la (dono ou admin p/ shared). */
  private async loadEditable(
    tenantId: string,
    userId: string,
    canManageShared: boolean,
    id: string,
  ) {
    const qr = await this.prisma.whatsappQuickReply.findFirst({ where: { id, tenantId } });
    if (!qr) throw new NotFoundException('Resposta rápida não encontrada');
    if (qr.ownerUserId === null && !canManageShared) {
      throw new ForbiddenException('Resposta compartilhada — requer permissão chat.admin.');
    }
    if (qr.ownerUserId !== null && qr.ownerUserId !== userId) {
      throw new ForbiddenException('Resposta pessoal de outro operador.');
    }
    return qr;
  }

  private assertScope(scope: 'shared' | 'personal', canManageShared: boolean) {
    if (scope === 'shared' && !canManageShared) {
      throw new ForbiddenException(
        'Só quem tem chat.admin pode criar/editar respostas compartilhadas da equipe.',
      );
    }
  }

  private validateBody(input: { title: string; body: string }) {
    if (!input.title.trim()) throw new BadRequestException('Título obrigatório.');
    if (!input.body.trim()) throw new BadRequestException('Texto obrigatório.');
    if (input.body.length > 4096) throw new BadRequestException('Texto excede 4096 caracteres.');
  }
}
