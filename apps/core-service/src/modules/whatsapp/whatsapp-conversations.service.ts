import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, WaConversationStatus } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

import { EvolutionClient } from './evolution.client';
import { WhatsappEventsBus } from './whatsapp-events.bus';

export type InboxFilter = 'mine' | 'unassigned' | 'all' | 'resolved';

@Injectable()
export class WhatsappConversationsService {
  private readonly logger = new Logger(WhatsappConversationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: WhatsappEventsBus,
    private readonly evolution: EvolutionClient,
  ) {}

  async list(tenantId: string, userId: string, filter: InboxFilter = 'mine') {
    const where: Prisma.WhatsappConversationWhereInput = { tenantId };

    if (filter === 'mine') {
      where.assignedUserId = userId;
      where.status = 'OPEN';
    } else if (filter === 'unassigned') {
      where.assignedUserId = null;
      where.status = 'OPEN';
    } else if (filter === 'resolved') {
      where.status = 'RESOLVED';
    } else {
      where.status = { in: ['OPEN', 'RESOLVED'] };
    }

    return this.prisma.whatsappConversation.findMany({
      where,
      orderBy: { lastMessageAt: 'desc' },
      take: 100,
      include: {
        contact: {
          include: {
            customer: {
              select: { id: true, displayName: true, code: true, status: true, type: true },
            },
          },
        },
        instance: { select: { id: true, name: true, phoneE164: true, status: true } },
        assignedUser: { select: { id: true, firstName: true, lastName: true, email: true } },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { id: true, body: true, type: true, direction: true, createdAt: true },
        },
      },
    });
  }

  /**
   * Detalhe da conversa + mensagens. Se quem chama NÃO é o assigned user
   * e a conversa tem assignedUserId, registra View (auditoria).
   *
   * Permissão: chat.read pra todas; chat.audit pra ver de outro operador.
   */
  async findById(
    tenantId: string,
    userId: string,
    canAudit: boolean,
    id: string,
  ) {
    const conv = await this.prisma.whatsappConversation.findFirst({
      where: { id, tenantId },
      include: {
        contact: {
          include: {
            customer: {
              select: {
                id: true,
                displayName: true,
                code: true,
                status: true,
                type: true,
                primaryPhone: true,
                primaryEmail: true,
              },
            },
          },
        },
        instance: { select: { id: true, name: true, phoneE164: true, status: true } },
        assignedUser: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });
    if (!conv) throw new NotFoundException('Conversa não encontrada');

    // Auditoria: se está atribuída a OUTRO usuário, requer chat.audit
    if (
      conv.assignedUserId &&
      conv.assignedUserId !== userId &&
      !canAudit
    ) {
      throw new ForbiddenException(
        'Conversa atribuída a outro operador. Permissão chat.audit necessária.',
      );
    }

    // Registra view se está espionando
    if (conv.assignedUserId && conv.assignedUserId !== userId) {
      await this.prisma.whatsappConversationView.create({
        data: { conversationId: conv.id, viewerUserId: userId },
      });
      await this.audit.log({
        tenantId,
        userId,
        action: 'whatsapp.conversation.viewed',
        resource: 'whatsapp_conversation',
        resourceId: conv.id,
        metadata: { assignedUserId: conv.assignedUserId },
      });
    }

    // Zera contador de não lidas se quem está vendo é o assigned
    if (conv.assignedUserId === userId && conv.unreadCount > 0) {
      await this.prisma.whatsappConversation.update({
        where: { id },
        data: { unreadCount: 0 },
      });
      this.events.emit({
        type: 'conversation.updated',
        tenantId,
        payload: { id, unreadCount: 0 },
      });
    }

    const messages = await this.prisma.whatsappMessage.findMany({
      where: { conversationId: id },
      orderBy: { createdAt: 'asc' },
      take: 200,
      include: {
        fromUser: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    return { ...conv, messages };
  }

  async assign(tenantId: string, actorUserId: string, id: string, targetUserId: string | null) {
    const conv = await this.prisma.whatsappConversation.findFirst({
      where: { id, tenantId },
    });
    if (!conv) throw new NotFoundException();

    if (targetUserId) {
      const u = await this.prisma.user.findFirst({
        where: { id: targetUserId, tenantId },
      });
      if (!u) throw new BadRequestException('Usuário inválido');
    }

    const updated = await this.prisma.whatsappConversation.update({
      where: { id },
      data: {
        assignedUserId: targetUserId,
        assignedAt: targetUserId ? new Date() : null,
      },
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: targetUserId === actorUserId
        ? 'whatsapp.conversation.taken'
        : targetUserId === null
        ? 'whatsapp.conversation.unassigned'
        : 'whatsapp.conversation.transferred',
      resource: 'whatsapp_conversation',
      resourceId: id,
      metadata: { fromUserId: conv.assignedUserId, toUserId: targetUserId },
    });

    this.events.emit({
      type: 'conversation.assigned',
      tenantId,
      payload: { id, assignedUserId: targetUserId, by: actorUserId },
    });

    return updated;
  }

  async resolve(tenantId: string, actorUserId: string, id: string) {
    const conv = await this.prisma.whatsappConversation.findFirst({
      where: { id, tenantId },
    });
    if (!conv) throw new NotFoundException();
    if (conv.status === 'RESOLVED') return conv;

    const updated = await this.prisma.whatsappConversation.update({
      where: { id },
      data: { status: 'RESOLVED', resolvedAt: new Date(), resolvedById: actorUserId },
    });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'whatsapp.conversation.resolved',
      resource: 'whatsapp_conversation',
      resourceId: id,
    });
    this.events.emit({
      type: 'conversation.resolved',
      tenantId,
      payload: { id, resolvedAt: updated.resolvedAt },
    });
    return updated;
  }

  /**
   * Envia mensagem de texto. Persiste localmente com status PENDING, dispara
   * pra Evolution; se sucesso atualiza com evolutionMsgId + status SENT,
   * se falha marca FAILED.
   */
  async sendText(tenantId: string, actorUserId: string, id: string, text: string) {
    const conv = await this.prisma.whatsappConversation.findFirst({
      where: { id, tenantId },
      include: { instance: true, contact: true },
    });
    if (!conv) throw new NotFoundException();

    // Apenas o assigned user pode enviar (ou ninguém atribuído)
    if (conv.assignedUserId && conv.assignedUserId !== actorUserId) {
      throw new ForbiddenException(
        'Conversa atribuída a outro operador. Assuma ou peça transferência.',
      );
    }

    if (conv.instance.status !== 'CONNECTED') {
      throw new BadRequestException(
        'Instância WhatsApp não está conectada. Verifique em Atendimento → Instâncias.',
      );
    }

    // Persiste primeiro (PENDING)
    const local = await this.prisma.whatsappMessage.create({
      data: {
        conversationId: id,
        direction: 'OUT',
        type: 'TEXT',
        body: text,
        fromUserId: actorUserId,
        status: 'PENDING',
      },
    });

    // Auto-atribui se não tinha ninguém
    if (!conv.assignedUserId) {
      await this.prisma.whatsappConversation.update({
        where: { id },
        data: { assignedUserId: actorUserId, assignedAt: new Date() },
      });
      this.events.emit({
        type: 'conversation.assigned',
        tenantId,
        payload: { id, assignedUserId: actorUserId, by: actorUserId },
      });
    }

    // Dispara
    try {
      const res = await this.evolution.sendText(
        conv.instance.evolutionUrl,
        conv.instance.apiKey,
        conv.instance.instanceName,
        conv.contact.phoneE164,
        text,
      );
      const updated = await this.prisma.whatsappMessage.update({
        where: { id: local.id },
        data: {
          status: 'SENT',
          evolutionMsgId: res.key?.id ?? null,
        },
      });

      await this.prisma.whatsappConversation.update({
        where: { id },
        data: { lastMessageAt: new Date() },
      });

      this.events.emit({
        type: 'message.created',
        tenantId,
        payload: {
          conversationId: id,
          messageId: updated.id,
          direction: 'OUT',
          type: 'TEXT',
          body: text,
          createdAt: updated.createdAt,
          fromUserId: actorUserId,
        },
      });

      await this.audit.log({
        tenantId,
        userId: actorUserId,
        action: 'whatsapp.message.sent',
        resource: 'whatsapp_message',
        resourceId: updated.id,
        metadata: { conversationId: id, length: text.length },
      });

      return updated;
    } catch (e) {
      const failed = await this.prisma.whatsappMessage.update({
        where: { id: local.id },
        data: { status: 'FAILED', errorReason: (e as Error).message },
      });
      this.events.emit({
        type: 'message.updated',
        tenantId,
        payload: { id: failed.id, conversationId: id, status: 'FAILED' },
      });
      throw new BadRequestException(`Falha ao enviar: ${(e as Error).message}`);
    }
  }

  async setStatus(
    tenantId: string,
    actorUserId: string,
    id: string,
    status: WaConversationStatus,
  ) {
    if (status === 'RESOLVED') return this.resolve(tenantId, actorUserId, id);
    const updated = await this.prisma.whatsappConversation.update({
      where: { id },
      data: { status },
    });
    this.events.emit({
      type: 'conversation.updated',
      tenantId,
      payload: { id, status },
    });
    return updated;
  }
}
