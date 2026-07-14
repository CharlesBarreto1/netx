import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import { join } from 'node:path';
import type { Prisma, WaConversationStatus, WaMsgType } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

import type { TemplateSend } from './providers/channel-provider';
import { ChannelProviderFactory } from './providers/channel-provider.factory';
import { WhatsappCredentials } from './providers/whatsapp-credentials';
import { WhatsappEventsBus } from './whatsapp-events.bus';
import { WhatsappMessagesService } from './whatsapp-messages.service';
import { WhatsappTranscriptionService } from './whatsapp-transcription.service';

export type InboxFilter =
  | 'mine'
  | 'unassigned'
  | 'all'
  | 'resolved'
  | 'groups'
  | 'groupsMine'
  | 'andamento'
  | 'espera'
  | 'automacao';

/** Janela de atendimento da Meta: 24h desde o último inbound do cliente. */
const META_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Onde a mídia (áudio enviado) é gravada, servida por GET /v1/whatsapp/media. */
const MEDIA_ROOT = process.env.WHATSAPP_MEDIA_ROOT ?? '/var/lib/netx/whatsapp/media';

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
    private readonly messages: WhatsappMessagesService,
    private readonly transcription: WhatsappTranscriptionService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Transcreve uma mensagem de áudio (sob demanda) via whisper.cpp local.
   * Persiste a transcrição na mensagem (idempotente — re-chamadas devolvem a
   * já existente) e emite SSE para a thread atualizar.
   */
  async transcribeMessage(tenantId: string, conversationId: string, messageId: string) {
    const msg = await this.prisma.whatsappMessage.findFirst({
      where: { id: messageId, conversationId, conversation: { tenantId } },
      select: { id: true, type: true, mediaUrl: true, transcription: true },
    });
    if (!msg) throw new NotFoundException('Mensagem não encontrada');
    if (msg.transcription) return { transcription: msg.transcription };
    if (msg.type !== 'AUDIO' && msg.type !== 'VIDEO') {
      throw new BadRequestException('Só dá para transcrever áudio (ou vídeo).');
    }
    if (!msg.mediaUrl) throw new BadRequestException('Áudio sem arquivo no servidor.');

    const filename = msg.mediaUrl.split('/').pop() ?? '';
    const transcription = await this.transcription.transcribeFile(filename);

    await this.prisma.whatsappMessage.update({
      where: { id: msg.id },
      data: { transcription },
    });
    this.events.emit({
      type: 'message.updated',
      tenantId,
      payload: { id: msg.id, conversationId, transcription },
    });
    return { transcription };
  }

  async list(tenantId: string, userId: string, filter: InboxFilter = 'mine') {
    // A linha NEXUS (copiloto interno) NÃO entra no inbox de atendimento — são
    // conversas operador↔copiloto, não clientes.
    const where: Prisma.WhatsappConversationWhereInput = {
      tenantId,
      instance: { purpose: 'SUPPORT' },
    };

    if (filter === 'groups' || filter === 'groupsMine') {
      // Aba de grupos: só conversas de grupo (qualquer status aberto).
      // 'groupsMine' = só os grupos em que ESTE operador entrou (é membro).
      where.contact = { isGroup: true };
      where.status = { in: ['OPEN', 'RESOLVED'] };
      if (filter === 'groupsMine') where.members = { some: { userId } };
    } else {
      // Demais filas são atendimento 1:1 — grupos ficam de fora pra não poluir.
      where.contact = { isGroup: false };
      if (filter === 'mine') {
        where.assignedUserId = userId;
        where.status = 'OPEN';
      } else if (filter === 'unassigned') {
        where.assignedUserId = null;
        where.status = 'OPEN';
      } else if (filter === 'andamento') {
        // Em atendimento humano: aberta, com operador, fora do bot.
        where.assignedUserId = { not: null };
        where.status = 'OPEN';
        where.botActive = false;
      } else if (filter === 'espera') {
        // Na fila: aberta, sem operador, fora do bot.
        where.assignedUserId = null;
        where.status = 'OPEN';
        where.botActive = false;
      } else if (filter === 'automacao') {
        // Conduzida pelo chatbot.
        where.status = 'OPEN';
        where.botActive = true;
      } else if (filter === 'resolved') {
        where.status = 'RESOLVED';
      } else {
        where.status = { in: ['OPEN', 'RESOLVED'] };
      }
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
        members: {
          include: { user: { select: { id: true, firstName: true, lastName: true } } },
          orderBy: { joinedAt: 'asc' },
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { id: true, body: true, type: true, direction: true, createdAt: true },
        },
      },
    });
  }

  /** Contadores por aba do inbox (Andamento / Espera / Automação / Resolvidos). */
  async counts(tenantId: string) {
    const base: Prisma.WhatsappConversationWhereInput = {
      tenantId,
      contact: { isGroup: false },
      instance: { purpose: 'SUPPORT' }, // exclui a linha NEXUS do inbox
    };
    const [andamento, espera, automacao, resolved] = await this.prisma.$transaction([
      this.prisma.whatsappConversation.count({
        where: { ...base, status: 'OPEN', botActive: false, assignedUserId: { not: null } },
      }),
      this.prisma.whatsappConversation.count({
        where: { ...base, status: 'OPEN', botActive: false, assignedUserId: null },
      }),
      this.prisma.whatsappConversation.count({ where: { ...base, status: 'OPEN', botActive: true } }),
      this.prisma.whatsappConversation.count({ where: { ...base, status: 'RESOLVED' } }),
    ]);
    return { andamento, espera, automacao, resolved };
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
        members: {
          include: { user: { select: { id: true, firstName: true, lastName: true } } },
          orderBy: { joinedAt: 'asc' },
        },
      },
    });
    if (!conv) throw new NotFoundException('Conversa não encontrada');

    if (conv.contact.isGroup) {
      // Grupos são atendimento COMPARTILHADO (NOC): qualquer operador com
      // chat.read pode abrir e ver, sem trava de auditoria/espião. Zera o
      // não-lidas quando QUEM ABRE é membro (já está atendendo o grupo).
      const isMember = conv.members.some((m) => m.userId === userId);
      if (isMember && conv.unreadCount > 0) {
        await this.prisma.whatsappConversation.update({
          where: { id },
          data: { unreadCount: 0 },
        });
        this.events.emit({ type: 'conversation.updated', tenantId, payload: { id, unreadCount: 0 } });
      }
    } else {
      // 1:1 — atendimento exclusivo (dono único).
      // Auditoria: se está atribuída a OUTRO usuário, requer chat.audit
      if (conv.assignedUserId && conv.assignedUserId !== userId && !canAudit) {
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
    }

    const messages = await this.prisma.whatsappMessage.findMany({
      where: { conversationId: id },
      orderBy: { createdAt: 'asc' },
      take: 200,
      include: {
        fromUser: { select: { id: true, firstName: true, lastName: true, chatPrefs: true } },
      },
    });

    return { ...conv, messages };
  }

  /**
   * Contexto do cliente pro painel do atendente: o customer vinculado ao contato
   * da conversa + seus contratos (o front busca conexão/diagnóstico/financeiro por
   * contrato nos endpoints já existentes). Não infla este endpoint.
   */
  async customerContext(tenantId: string, id: string) {
    const conv = await this.prisma.whatsappConversation.findFirst({
      where: { id, tenantId },
      select: { contact: { select: { id: true, phoneE164: true, pushName: true, customerId: true } } },
    });
    if (!conv) throw new NotFoundException('Conversa não encontrada');
    const contact = conv.contact;

    if (!contact.customerId) {
      return { contact, customer: null, contracts: [] };
    }

    const customer = await this.prisma.customer.findFirst({
      where: { id: contact.customerId, tenantId, deletedAt: null },
      select: {
        id: true,
        displayName: true,
        code: true,
        status: true,
        type: true,
        primaryPhone: true,
        primaryEmail: true,
      },
    });

    const contracts = await this.prisma.contract.findMany({
      where: { customerId: contact.customerId, tenantId, deletedAt: null },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        code: true,
        status: true,
        suspendReason: true,
        trustExtensionUntil: true,
        monthlyValue: true,
        bandwidthMbps: true,
        uploadMbps: true,
        pppoeUsername: true,
        plan: { select: { name: true } },
      },
    });

    return {
      contact,
      customer,
      contracts: contracts.map((c) => ({
        id: c.id,
        code: c.code,
        status: c.status,
        suspendReason: c.suspendReason,
        trustExtensionUntil: c.trustExtensionUntil,
        planName: c.plan?.name ?? null,
        monthlyValue: Number(c.monthlyValue),
        bandwidthMbps: c.bandwidthMbps,
        uploadMbps: c.uploadMbps,
        pppoeUsername: c.pppoeUsername,
      })),
    };
  }

  /**
   * Mensagens anteriores a um cursor (createdAt ISO) — scroll pra cima estilo
   * WhatsApp. Devolve em ordem cronológica (asc). Mesma regra de acesso do
   * findById (assigned ou chat.audit).
   */
  async messagesBefore(
    tenantId: string,
    userId: string,
    canAudit: boolean,
    id: string,
    before: Date,
    limit = 50,
  ) {
    const conv = await this.prisma.whatsappConversation.findFirst({
      where: { id, tenantId },
      select: { assignedUserId: true, contact: { select: { isGroup: true } } },
    });
    if (!conv) throw new NotFoundException('Conversa não encontrada');
    // Grupos são compartilhados — qualquer chat.read lê o histórico. 1:1 mantém
    // a trava de dono (precisa chat.audit pra ver de outro operador).
    if (!conv.contact.isGroup && conv.assignedUserId && conv.assignedUserId !== userId && !canAudit) {
      throw new ForbiddenException('Conversa atribuída a outro operador.');
    }
    const rows = await this.prisma.whatsappMessage.findMany({
      where: { conversationId: id, createdAt: { lt: before } },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 100),
      include: { fromUser: { select: { id: true, firstName: true, lastName: true, chatPrefs: true } } },
    });
    return rows.reverse(); // cronológico (antigas → novas)
  }

  /**
   * Lista os agentes para quem uma conversa pode ser transferida: usuários
   * ativos do tenant cujas roles têm alguma permissão de atendimento (chat.*).
   * Gated por chat.assign no controller.
   */
  async listAgents(tenantId: string) {
    const users = await this.prisma.user.findMany({
      where: {
        tenantId,
        status: 'ACTIVE',
        deletedAt: null,
        userRoles: {
          some: {
            role: {
              rolePermissions: {
                some: { permission: { code: { in: ['chat.read', 'chat.send', 'chat.assign'] } } },
              },
            },
          },
        },
      },
      select: { id: true, firstName: true, lastName: true, email: true },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      take: 200,
    });
    return users;
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

    // Saudação automática quando o operador ASSUME pra si (não em transferência).
    // Não-fatal: falha na saudação não derruba o assign.
    if (targetUserId && targetUserId === actorUserId) {
      await this.maybeSendGreeting(tenantId, actorUserId, id).catch((e) =>
        this.logger.warn(`Saudação automática falhou (${id}): ${(e as Error).message}`),
      );
    }

    return updated;
  }

  /**
   * Dispara a saudação automática do operador, se configurada (chatPrefs.greeting)
   * e a conversa estiver apta a receber texto livre (dentro da janela 24h no Meta /
   * sessão conectada no WAHA). Placeholders: {operador}, {cliente}.
   */
  private async maybeSendGreeting(tenantId: string, userId: string, conversationId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
      select: { firstName: true, lastName: true, chatPrefs: true },
    });
    const prefs = (user?.chatPrefs ?? {}) as { greeting?: string };
    const greeting = prefs.greeting?.trim();
    if (!greeting) return;

    const conv = await this.prisma.whatsappConversation.findFirst({
      where: { id: conversationId, tenantId },
      include: { instance: true, contact: true },
    });
    if (!conv) return;
    if (conv.instance.channel === 'META_CLOUD' && !this.withinMetaWindow(conv.lastInboundAt)) return;
    if (conv.instance.channel === 'WAHA' && conv.instance.status !== 'CONNECTED') return;

    const operador = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim();
    const cliente = conv.contact.pushName?.trim() ?? '';
    const text = greeting
      .replace(/\{operador\}/gi, operador)
      .replace(/\{cliente\}/gi, cliente)
      .replace(/\s{2,}/g, ' ')
      .trim();

    await this.dispatchOutbound(tenantId, conv, {
      type: 'TEXT',
      body: text,
      actor: userId,
      fromUserId: userId,
      autoAssign: false,
      send: (provider, dInst) =>
        provider.sendText(dInst, conv.contact.phoneE164 ?? '', text, conv.contact.waChatId),
      auditMeta: { conversationId, greeting: true },
    });
  }

  /** Preferências do operador no chat (saudação + mostrar nome). Self-service. */
  async getAgentSettings(tenantId: string, userId: string) {
    const u = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
      select: { chatPrefs: true },
    });
    const p = (u?.chatPrefs ?? {}) as { greeting?: string; showName?: boolean };
    return { greeting: p.greeting ?? '', showName: p.showName !== false };
  }

  async setAgentSettings(
    tenantId: string,
    userId: string,
    input: { greeting?: string; showName?: boolean },
  ) {
    const current = await this.getAgentSettings(tenantId, userId);
    const next = {
      greeting: input.greeting !== undefined ? input.greeting.trim() : current.greeting,
      showName: input.showName !== undefined ? input.showName : current.showName,
    };
    await this.prisma.user.update({
      where: { id: userId },
      data: { chatPrefs: next as unknown as Prisma.InputJsonValue },
    });
    return next;
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
   * Entrar num grupo (NOC): adiciona o operador como MEMBRO. Vários operadores
   * podem entrar simultaneamente — todos respondem e são notificados. Idempotente
   * (entrar de novo não duplica). Só faz sentido em conversas de grupo.
   */
  async joinGroup(tenantId: string, userId: string, id: string) {
    const conv = await this.prisma.whatsappConversation.findFirst({
      where: { id, tenantId },
      include: { contact: { select: { isGroup: true } } },
    });
    if (!conv) throw new NotFoundException('Conversa não encontrada');
    if (!conv.contact.isGroup) {
      throw new BadRequestException('Entrar/sair só vale para grupos. No 1:1 use Assumir.');
    }

    await this.prisma.whatsappConversationMember.upsert({
      where: { conversationId_userId: { conversationId: id, userId } },
      create: { conversationId: id, userId },
      update: {},
    });
    await this.audit.log({
      tenantId,
      userId,
      action: 'whatsapp.group.joined',
      resource: 'whatsapp_conversation',
      resourceId: id,
    });
    this.events.emit({ type: 'conversation.updated', tenantId, payload: { id, memberJoined: userId } });
    return this.membersOf(id);
  }

  /** Sair de um grupo: remove o operador da lista de membros. */
  async leaveGroup(tenantId: string, userId: string, id: string) {
    const conv = await this.prisma.whatsappConversation.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });
    if (!conv) throw new NotFoundException('Conversa não encontrada');

    await this.prisma.whatsappConversationMember
      .delete({ where: { conversationId_userId: { conversationId: id, userId } } })
      .catch(() => undefined); // já não era membro — no-op
    await this.audit.log({
      tenantId,
      userId,
      action: 'whatsapp.group.left',
      resource: 'whatsapp_conversation',
      resourceId: id,
    });
    this.events.emit({ type: 'conversation.updated', tenantId, payload: { id, memberLeft: userId } });
    return this.membersOf(id);
  }

  /** Membros atuais de uma conversa (operadores que entraram no grupo). */
  private async membersOf(conversationId: string) {
    return this.prisma.whatsappConversationMember.findMany({
      where: { conversationId },
      select: {
        userId: true,
        joinedAt: true,
        user: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { joinedAt: 'asc' },
    });
  }

  /**
   * Envia texto. Canal-agnóstico via provider. Para o canal META_CLOUD respeita
   * a janela de 24h: fora dela, lança TemplateRequiredException (o front então
   * oferece um template HSM via sendTemplate).
   */
  async sendText(
    tenantId: string,
    actorUserId: string,
    id: string,
    text: string,
    mentions?: string[],
  ) {
    const conv = await this.loadSendableConversation(tenantId, actorUserId, id);

    // Janela 24h só se aplica ao canal oficial Meta.
    if (conv.instance.channel === 'META_CLOUD' && !this.withinMetaWindow(conv.lastInboundAt)) {
      throw new TemplateRequiredException();
    }

    // Prefixo "*Nome do operador*" — vai NO TEXTO enviado ao WhatsApp do cliente
    // (o netx mostra o nome via label separado; por isso o `body` salvo fica
    // SEM o prefixo, pra não duplicar). Respeita o toggle "mostrar nome".
    const sender = await this.prisma.user.findFirst({
      where: { id: actorUserId, tenantId },
      select: { firstName: true, lastName: true, chatPrefs: true },
    });
    const showName = ((sender?.chatPrefs ?? {}) as { showName?: boolean }).showName !== false;
    const opName = [sender?.firstName, sender?.lastName].filter(Boolean).join(' ').trim();
    const outgoing = showName && opName ? `*${opName}*\n${text}` : text;

    const sent = await this.dispatchOutbound(tenantId, conv, {
      type: 'TEXT',
      body: text,
      actor: actorUserId,
      fromUserId: actorUserId,
      autoAssign: true,
      // Menções internas (@operador) — acionam colegas específicos no grupo.
      mentions: mentions?.length ? mentions : undefined,
      // Responde no JID exato do inbound (pode ser @lid / @g.us de grupo);
      // o telefone é só fallback e em grupos não existe (phoneE164 null).
      send: (provider, dInst) =>
        provider.sendText(dInst, conv.contact.phoneE164 ?? '', outgoing, conv.contact.waChatId),
      auditMeta: { conversationId: id, length: text.length },
    });

    // Menções: grava notificação PERSISTENTE pros acionados (sino global). O SSE
    // do WhatsApp já dá o toast em tempo real; isto sobrevive a reload e some só
    // quando o operador limpa. Não-fatal.
    const mentioned = (mentions ?? []).filter((uid) => uid && uid !== actorUserId);
    if (mentioned.length) {
      const groupName = conv.contact.pushName?.trim() || 'grupo';
      const preview = text.length > 140 ? `${text.slice(0, 140)}…` : text;
      await this.notifications
        .notifyMany(mentioned, {
          tenantId,
          type: 'chat.mention',
          title: opName ? `${opName} mencionou você em ${groupName}` : `Você foi mencionado em ${groupName}`,
          body: preview,
          href: `/chat?c=${id}`,
          icon: 'message',
          data: { conversationId: id },
        })
        .catch((e) => this.logger.warn(`Falha ao notificar menções (${id}): ${(e as Error).message}`));
    }
    return sent;
  }

  /**
   * Envia uma NOTA DE VOZ gravada no atendente. Converte o áudio do navegador
   * (webm/opus) para OGG/Opus (formato da Meta), salva pra tocar no inbox e
   * dispara. Respeita a janela de 24h (mídia é fora de template).
   */
  async sendAudio(
    tenantId: string,
    actorUserId: string,
    id: string,
    file: { buffer: Buffer; mimetype?: string },
  ) {
    const conv = await this.loadSendableConversation(tenantId, actorUserId, id);
    if (conv.instance.channel === 'META_CLOUD' && !this.withinMetaWindow(conv.lastInboundAt)) {
      throw new TemplateRequiredException();
    }

    const ogg = await this.transcription.toVoiceOgg(file.buffer);
    const filename = `out-${randomUUID()}.ogg`;
    await fsp.mkdir(MEDIA_ROOT, { recursive: true }).catch(() => {});
    await fsp.writeFile(join(MEDIA_ROOT, filename), ogg);
    const base64 = ogg.toString('base64');

    return this.dispatchOutbound(tenantId, conv, {
      type: 'AUDIO',
      body: null,
      mediaUrl: `/v1/whatsapp/media/${filename}`,
      mediaMimeType: 'audio/ogg',
      mediaSize: ogg.length,
      actor: actorUserId,
      fromUserId: actorUserId,
      autoAssign: true,
      send: (provider, dInst) =>
        provider.sendMedia(
          dInst,
          conv.contact.phoneE164 ?? '',
          { mediatype: 'audio', mimetype: 'audio/ogg', media: base64 },
          conv.contact.waChatId,
        ),
      auditMeta: { conversationId: id, audio: true, bytes: ogg.length },
    });
  }

  /**
   * Envia uma IMAGEM ou ARQUIVO anexado pelo atendente. Detecta o tipo pelo
   * mimetype (image/video/document), salva pra exibir no inbox e dispara via
   * provider.sendMedia. Aceita `caption` (legenda, vai junto na mídia).
   * Respeita a janela de 24h (mídia é fora de template, igual ao áudio).
   */
  async sendMediaFile(
    tenantId: string,
    actorUserId: string,
    id: string,
    file: { buffer: Buffer; mimetype?: string; originalName?: string },
    caption?: string,
  ) {
    const conv = await this.loadSendableConversation(tenantId, actorUserId, id);
    if (conv.instance.channel === 'META_CLOUD' && !this.withinMetaWindow(conv.lastInboundAt)) {
      throw new TemplateRequiredException();
    }

    const mime = (file.mimetype || 'application/octet-stream').toLowerCase();
    const { mediatype, msgType } = this.classifyMedia(mime);
    const ext = this.extForMedia(mime, file.originalName);
    const filename = `out-${randomUUID()}${ext}`;
    await fsp.mkdir(MEDIA_ROOT, { recursive: true }).catch(() => {});
    await fsp.writeFile(join(MEDIA_ROOT, filename), file.buffer);
    const base64 = file.buffer.toString('base64');
    const cap = caption?.trim() || undefined;
    const docName =
      mediatype === 'document' ? (file.originalName?.trim() || `arquivo${ext}`) : undefined;

    return this.dispatchOutbound(tenantId, conv, {
      type: msgType,
      // Documento sem legenda mostra o nome do arquivo na bolha; demais usam a legenda.
      body: cap ?? (mediatype === 'document' ? docName ?? null : null),
      mediaUrl: `/v1/whatsapp/media/${filename}`,
      mediaMimeType: mime,
      mediaSize: file.buffer.length,
      actor: actorUserId,
      fromUserId: actorUserId,
      autoAssign: true,
      send: (provider, dInst) =>
        provider.sendMedia(
          dInst,
          conv.contact.phoneE164 ?? '',
          { mediatype, mimetype: mime, media: base64, caption: cap, fileName: docName },
          conv.contact.waChatId,
        ),
      auditMeta: { conversationId: id, media: mediatype, bytes: file.buffer.length },
    });
  }

  /** Mapeia mimetype → tipo de mídia do provider + tipo de mensagem persistida. */
  private classifyMedia(mime: string): {
    mediatype: 'image' | 'video' | 'document' | 'audio';
    msgType: WaMsgType;
  } {
    if (mime.startsWith('image/')) return { mediatype: 'image', msgType: 'IMAGE' };
    if (mime.startsWith('video/')) return { mediatype: 'video', msgType: 'VIDEO' };
    if (mime.startsWith('audio/')) return { mediatype: 'audio', msgType: 'AUDIO' };
    return { mediatype: 'document', msgType: 'DOCUMENT' };
  }

  /** Extensão do arquivo salvo: preserva a do nome original; senão deriva do mime. */
  private extForMedia(mime: string, originalName?: string): string {
    const fromName = originalName?.includes('.')
      ? `.${originalName.split('.').pop()!.toLowerCase()}`
      : '';
    if (fromName && fromName.length <= 6) return fromName;
    const map: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
      'image/gif': '.gif',
      'video/mp4': '.mp4',
      'application/pdf': '.pdf',
    };
    return map[mime] ?? '.bin';
  }

  /**
   * Envia texto COMO BOT: sem operador (fromUserId null, isBot) e SEM
   * auto-atribuir — a conversa segue "livre" pra um humano assumir. Não valida
   * dono (o bot age em conversas não atribuídas, garantido pelo BotService).
   */
  async sendAsBot(tenantId: string, conversationId: string, text: string) {
    const conv = await this.prisma.whatsappConversation.findFirst({
      where: { id: conversationId, tenantId },
      include: { instance: true, contact: true },
    });
    if (!conv) throw new NotFoundException('Conversa não encontrada');
    if (conv.instance.channel === 'WAHA' && conv.instance.status !== 'CONNECTED') {
      throw new BadRequestException('Instância WhatsApp não conectada.');
    }
    return this.dispatchOutbound(tenantId, conv, {
      type: 'TEXT',
      body: text,
      actor: 'system:bot',
      fromUserId: null,
      autoAssign: false,
      isBot: true,
      send: (provider, dInst) =>
        provider.sendText(dInst, conv.contact.phoneE164 ?? '', text, conv.contact.waChatId),
      auditMeta: { conversationId, length: text.length, bot: true },
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

    return this.dispatchOutbound(tenantId, conv, {
      type: 'TEXT',
      body: previewBody ?? `[template: ${tpl.name}]`,
      templateName: tpl.name,
      actor: actorUserId,
      fromUserId: actorUserId,
      autoAssign: true,
      send: (provider, dInst) => provider.sendTemplate(dInst, conv.contact.phoneE164 ?? '', tpl),
      auditMeta: { conversationId: id, template: tpl.name },
    });
  }

  /**
   * Envia um template HSM diretamente para um TELEFONE — sem exigir conversa
   * prévia nem janela de 24h (templates são liberados pela Meta). Cria/reusa a
   * conversa e persiste a OUT. Usado por automações (cobrança) e pelo endpoint
   * de outbound. Resolve a instância Meta ativa do tenant se não for informada.
   */
  async sendTemplateToPhone(
    tenantId: string,
    opts: {
      phoneE164: string;
      templateName: string;
      language: string;
      variables?: string[];
      name?: string | null;
      instanceId?: string;
      actor?: string;
      previewBody?: string;
    },
  ) {
    const instance = opts.instanceId
      ? await this.prisma.whatsappInstance.findFirst({ where: { id: opts.instanceId, tenantId } })
      : await this.prisma.whatsappInstance.findFirst({
          where: { tenantId, channel: 'META_CLOUD', active: true },
          orderBy: { createdAt: 'asc' },
        });
    if (!instance) throw new NotFoundException('Sem instância Meta ativa para envio.');
    if (instance.channel !== 'META_CLOUD') {
      throw new BadRequestException('Envio por template exige o canal oficial Meta.');
    }

    const base = await this.messages.ensureOutboundConversation(
      tenantId,
      instance.id,
      opts.phoneE164,
      opts.name ?? null,
    );
    const conv = await this.prisma.whatsappConversation.findFirstOrThrow({
      where: { id: base.id },
      include: { instance: true, contact: true },
    });

    const tpl: TemplateSend = {
      name: opts.templateName,
      language: opts.language,
      variables: opts.variables,
    };
    return this.dispatchOutbound(tenantId, conv, {
      type: 'TEXT',
      body: opts.previewBody ?? `[template: ${tpl.name}]`,
      templateName: tpl.name,
      actor: opts.actor ?? 'system:outbound',
      fromUserId: null,
      autoAssign: false,
      send: (provider, dInst) => provider.sendTemplate(dInst, conv.contact.phoneE164 ?? '', tpl),
      auditMeta: { phone: conv.contact.phoneE164, template: tpl.name, outbound: true },
    });
  }

  /** Carrega a conversa e valida que o ator pode enviar nela. */
  private async loadSendableConversation(tenantId: string, actorUserId: string, id: string) {
    const conv = await this.prisma.whatsappConversation.findFirst({
      where: { id, tenantId },
      include: { instance: true, contact: true },
    });
    if (!conv) throw new NotFoundException();

    if (conv.contact.isGroup) {
      // Grupo (NOC): atendimento compartilhado. Só MEMBROS (quem entrou) podem
      // responder — vários simultâneos. Sem dono único.
      const member = await this.prisma.whatsappConversationMember.findUnique({
        where: { conversationId_userId: { conversationId: id, userId: actorUserId } },
      });
      if (!member) {
        throw new ForbiddenException(
          'Entre no grupo (botão "Atender") para responder. Vários operadores podem atender juntos.',
        );
      }
    } else if (conv.assignedUserId && conv.assignedUserId !== actorUserId) {
      // 1:1 — apenas o assigned user pode enviar (ou ninguém atribuído).
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
    conv: Prisma.WhatsappConversationGetPayload<{ include: { instance: true; contact: true } }>,
    opts: {
      type: WaMsgType;
      body: string | null;
      templateName?: string;
      auditMeta?: Prisma.InputJsonObject;
      // Quem envia: operador (uuid) ou o bot. `fromUserId` é a FK do User (null
      // p/ bot); `actor` é só p/ auditoria (aceita 'system:bot').
      actor: string;
      fromUserId: string | null;
      autoAssign: boolean;
      isBot?: boolean;
      // Menções internas (@operador) — acionam colegas na mensagem (só notif).
      mentions?: string[];
      // Mídia de saída (ex.: áudio gravado) — persistida pra tocar no inbox.
      mediaUrl?: string | null;
      mediaMimeType?: string | null;
      mediaSize?: number | null;
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
        fromUserId: opts.fromUserId,
        isBot: opts.isBot ?? false,
        mediaUrl: opts.mediaUrl ?? null,
        mediaMimeType: opts.mediaMimeType ?? null,
        mediaSize: opts.mediaSize ?? null,
        status: 'PENDING',
      },
    });

    // Auto-atribui ao operador se ninguém estava atribuído (bot nunca atribui —
    // mantém a conversa "livre" pra um humano assumir quando quiser). GRUPOS
    // NÃO têm dono único (atendimento compartilhado do NOC) — pula o auto-assign.
    if (opts.autoAssign && opts.fromUserId && !conv.assignedUserId && !conv.contact.isGroup) {
      await this.prisma.whatsappConversation.update({
        where: { id },
        data: { assignedUserId: opts.fromUserId, assignedAt: new Date() },
      });
      this.events.emit({
        type: 'conversation.assigned',
        tenantId,
        payload: { id, assignedUserId: opts.fromUserId, by: opts.fromUserId },
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
          fromUserId: opts.fromUserId,
          isBot: updated.isBot,
          isGroup: conv.contact.isGroup,
          // Menções: o cliente notifica os operadores acionados (mesmo em OUT).
          mentionUserIds: opts.mentions,
        },
      });
      // Auditoria é não-fatal: a mensagem JÁ foi enviada (provider retornou). Um
      // erro aqui não pode reverter o status para FAILED. `userId` é o UUID real
      // (ou null em envios de sistema); o rótulo textual vai em `actor`.
      try {
        await this.audit.log({
          tenantId,
          userId: opts.fromUserId,
          actor: opts.actor,
          action: opts.isBot ? 'whatsapp.bot.message.sent' : 'whatsapp.message.sent',
          resource: 'whatsapp_message',
          resourceId: updated.id,
          metadata: opts.auditMeta ?? { conversationId: id },
        });
      } catch (e) {
        this.logger.warn(`Falha ao auditar envio ${updated.id}: ${(e as Error).message}`);
      }
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
