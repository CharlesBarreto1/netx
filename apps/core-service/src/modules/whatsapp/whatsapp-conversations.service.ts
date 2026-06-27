import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, WaConversationStatus, WaMsgType } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

import type { TemplateSend } from './providers/channel-provider';
import { ChannelProviderFactory } from './providers/channel-provider.factory';
import { WhatsappCredentials } from './providers/whatsapp-credentials';
import { WhatsappEventsBus } from './whatsapp-events.bus';

export type InboxFilter = 'mine' | 'unassigned' | 'all' | 'resolved';

/** Janela de atendimento da Meta: 24h desde o último inbound do cliente. */
const META_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Erro estruturado: envio livre bloqueado fora da janela 24h (Meta). */
export class TemplateRequiredException extends BadRequestException {
  constructor() {
    super({
      statusCode: 400,
      requiresTemplate: true,
      message:
        'Fora da janela de 24h. No canal oficial Meta, use um template aprovado (HSM) para responder.',
    });
  }
}

@Injectable()
export class WhatsappConversationsService {
  private readonly logger = new Logger(WhatsappConversationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: WhatsappEventsBus,
    private readonly factory: ChannelProviderFactory,
    private readonly creds: WhatsappCredentials,
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
        instance: { select: { id: true, name: true, phoneE164: true, status: true, channel: true } },
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
        instance: { select: { id: true, name: true, phoneE164: true, status: true, channel: true } },
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
   * Envia texto. Canal-agnóstico via provider. Para o canal META_CLOUD respeita
   * a janela de 24h: fora dela, lança TemplateRequiredException (o front então
   * oferece um template HSM via sendTemplate).
   */
  async sendText(tenantId: string, actorUserId: string, id: string, text: string) {
    const conv = await this.loadSendableConversation(tenantId, actorUserId, id);

    // Janela 24h só se aplica ao canal oficial Meta.
    if (conv.instance.channel === 'META_CLOUD' && !this.withinMetaWindow(conv.lastInboundAt)) {
      throw new TemplateRequiredException();
    }

    return this.dispatchOutbound(tenantId, actorUserId, conv, {
      type: 'TEXT',
      body: text,
      // Responde no JID exato do inbound (pode ser @lid); fallback p/ telefone.
      send: (provider, dInst) =>
        provider.sendText(dInst, conv.contact.phoneE164, text, conv.contact.waChatId),
      auditMeta: { conversationId: id, length: text.length },
    });
  }

  /**
   * Envia um template HSM (canal META_CLOUD). Permitido dentro e fora da janela
   * de 24h. Persiste como mensagem OUT com `templateName` para auditoria.
   */
  async sendTemplate(
    tenantId: string,
    actorUserId: string,
    id: string,
    tpl: TemplateSend,
    previewBody?: string,
  ) {
    const conv = await this.loadSendableConversation(tenantId, actorUserId, id);
    if (conv.instance.channel !== 'META_CLOUD') {
      throw new BadRequestException('Templates HSM só existem no canal oficial Meta.');
    }

    return this.dispatchOutbound(tenantId, actorUserId, conv, {
      type: 'TEXT',
      body: previewBody ?? `[template: ${tpl.name}]`,
      templateName: tpl.name,
      send: (provider, dInst) => provider.sendTemplate(dInst, conv.contact.phoneE164, tpl),
      auditMeta: { conversationId: id, template: tpl.name },
    });
  }

  /** Carrega a conversa e valida que o ator pode enviar nela. */
  private async loadSendableConversation(tenantId: string, actorUserId: string, id: string) {
    const conv = await this.prisma.whatsappConversation.findFirst({
      where: { id, tenantId },
      include: { instance: true, contact: true },
    });
    if (!conv) throw new NotFoundException();

    // Apenas o assigned user pode enviar (ou ninguém atribuído).
    if (conv.assignedUserId && conv.assignedUserId !== actorUserId) {
      throw new ForbiddenException(
        'Conversa atribuída a outro operador. Assuma ou peça transferência.',
      );
    }

    // WAHA exige sessão conectada; Meta está conectada enquanto o token vale.
    if (conv.instance.channel === 'WAHA' && conv.instance.status !== 'CONNECTED') {
      throw new BadRequestException(
        'Instância WhatsApp não está conectada. Verifique em Atendimento → Instâncias.',
      );
    }
    return conv;
  }

  private withinMetaWindow(lastInboundAt: Date | null): boolean {
    if (!lastInboundAt) return false;
    return Date.now() - lastInboundAt.getTime() < META_WINDOW_MS;
  }

  /**
   * Persiste PENDING → dispara no provider → SENT/FAILED, auto-atribui, emite
   * SSE e audita. Compartilhado por sendText e sendTemplate.
   */
  private async dispatchOutbound(
    tenantId: string,
    actorUserId: string,
    conv: Prisma.WhatsappConversationGetPayload<{ include: { instance: true; contact: true } }>,
    opts: {
      type: WaMsgType;
      body: string | null;
      templateName?: string;
      auditMeta?: Prisma.InputJsonObject;
      send: (
        provider: ReturnType<ChannelProviderFactory['for']>,
        dInst: ReturnType<WhatsappCredentials['decrypt']>,
      ) => Promise<{ providerMsgId: string }>;
    },
  ) {
    const id = conv.id;

    // Persiste primeiro (PENDING).
    const local = await this.prisma.whatsappMessage.create({
      data: {
        conversationId: id,
        direction: 'OUT',
        type: opts.type,
        body: opts.body,
        templateName: opts.templateName ?? null,
        fromUserId: actorUserId,
        status: 'PENDING',
      },
    });

    // Auto-atribui se não tinha ninguém.
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

    try {
      const provider = this.factory.for(conv.instance.channel);
      const dInst = this.creds.decrypt(conv.instance);
      const res = await opts.send(provider, dInst);

      const updated = await this.prisma.whatsappMessage.update({
        where: { id: local.id },
        data: { status: 'SENT', providerMsgId: res.providerMsgId || null },
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
          type: updated.type,
          body: updated.body,
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
        metadata: opts.auditMeta ?? { conversationId: id },
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
