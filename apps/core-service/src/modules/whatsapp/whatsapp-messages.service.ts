import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

import type { CanonicalMessage, CanonicalStatusUpdate } from './providers/channel-provider';
import { WhatsappEventsBus } from './whatsapp-events.bus';

const MEDIA_ROOT = process.env.WHATSAPP_MEDIA_ROOT ?? '/var/lib/netx/whatsapp/media';

/**
 * Persistência de mensagens canônicas (já parseadas pelo provider).
 * O webhook controller chama parseWebhook no provider, resolve mídia e
 * entrega CanonicalMessage/CanonicalStatusUpdate aqui.
 *
 * Idempotência: `providerMsgId` é UNIQUE — webhook reentregue não duplica.
 */
@Injectable()
export class WhatsappMessagesService {
  private readonly logger = new Logger(WhatsappMessagesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: WhatsappEventsBus,
  ) {}

  /**
   * Resolve ou cria conversa OPEN para (instance, contact). Re-abre conversa
   * RESOLVED se nova mensagem chegar do mesmo contato.
   */
  private async upsertConversation(
    tenantId: string,
    instanceId: string,
    contactId: string,
    isInbound: boolean,
  ) {
    // Reusa a thread existente (OPEN/RESOLVED/ARCHIVED) pra manter o histórico
    // contínuo estilo WhatsApp — só (instanceId, contactId) define a thread.
    const existingOpen = await this.prisma.whatsappConversation.findFirst({
      where: { instanceId, contactId, status: { in: ['OPEN', 'RESOLVED', 'ARCHIVED'] } },
      orderBy: { lastMessageAt: 'desc' },
    });

    if (existingOpen) {
      const updates: Prisma.WhatsappConversationUpdateInput = {
        lastMessageAt: new Date(),
        ...(isInbound
          ? { lastInboundAt: new Date(), unreadCount: { increment: 1 } }
          : {}),
      };
      // Re-abre se estava resolvida/arquivada e o cliente mandou nova msg.
      if ((existingOpen.status === 'RESOLVED' || existingOpen.status === 'ARCHIVED') && isInbound) {
        updates.status = 'OPEN';
        updates.resolvedAt = null;
      }
      return this.prisma.whatsappConversation.update({
        where: { id: existingOpen.id },
        data: updates,
      });
    }

    return this.prisma.whatsappConversation.create({
      data: {
        tenantId,
        instanceId,
        contactId,
        lastMessageAt: new Date(),
        lastInboundAt: isInbound ? new Date() : null,
        unreadCount: isInbound ? 1 : 0,
      },
    });
  }

  /**
   * Resolve ou cria contato pelo número E164. Linka com Customer se houver
   * match em `Customer.primaryPhone` (ignorando formatação).
   */
  private async upsertContact(
    tenantId: string,
    phoneE164: string,
    pushName: string | null,
    waChatId: string | null = null,
  ) {
    const digits = phoneE164.replace(/\D/g, '');
    const e164 = `+${digits}`;

    const existing = await this.prisma.whatsappContact.findUnique({
      where: { tenantId_phoneE164: { tenantId, phoneE164: e164 } },
    });
    if (existing) {
      // Atualiza pushName e/ou waChatId se mudaram (waChatId é crítico p/ responder).
      const patch: { pushName?: string; waChatId?: string } = {};
      if (pushName && pushName !== existing.pushName) patch.pushName = pushName;
      if (waChatId && waChatId !== existing.waChatId) patch.waChatId = waChatId;
      if (Object.keys(patch).length) {
        return this.prisma.whatsappContact.update({ where: { id: existing.id }, data: patch });
      }
      return existing;
    }

    // Tenta match com Customer pelo telefone (ignora máscara)
    const candidates = await this.prisma.customer.findMany({
      where: { tenantId, deletedAt: null, primaryPhone: { not: null } },
      select: { id: true, primaryPhone: true },
      take: 100,
    });
    const match = candidates.find(
      (c) => c.primaryPhone && c.primaryPhone.replace(/\D/g, '').endsWith(digits.slice(-9)),
    );

    return this.prisma.whatsappContact.create({
      data: {
        tenantId,
        phoneE164: e164,
        pushName,
        waChatId,
        customerId: match?.id ?? null,
      },
    });
  }

  /**
   * Persiste media base64 em disco. Retorna URL relativa servida pelo
   * core-service em /v1/whatsapp/media/{filename}.
   */
  private async persistMedia(
    base64: string,
    mimeType: string,
    msgId: string,
  ): Promise<{ url: string; size: number }> {
    const ext = (mimeType.split('/')[1] ?? 'bin').split(';')[0];
    const filename = `${msgId}.${ext}`;
    const dir = MEDIA_ROOT;
    await fs.mkdir(dir, { recursive: true });
    const buf = Buffer.from(base64, 'base64');
    await fs.writeFile(join(dir, filename), buf);
    return {
      url: `/v1/whatsapp/media/${filename}`,
      size: buf.length,
    };
  }

  /**
   * Persiste uma mensagem canônica (in ou out-echo). Faz dedup por
   * providerMsgId, upsert de contato/conversa, grava mídia (se já veio base64
   * em media.data) e emite SSE.
   */
  async ingestMessage(
    instanceId: string,
    tenantId: string,
    msg: CanonicalMessage,
  ): Promise<{ messageId: string; conversationId: string } | null> {
    if (!msg.providerMsgId || !msg.contactPhone) {
      this.logger.warn('CanonicalMessage sem providerMsgId/contactPhone — ignorando');
      return null;
    }

    // Dedup: já temos essa mensagem?
    const existing = await this.prisma.whatsappMessage.findUnique({
      where: { providerMsgId: msg.providerMsgId },
    });
    if (existing) return { messageId: existing.id, conversationId: existing.conversationId };

    const isInbound = msg.direction === 'IN';
    const contact = await this.upsertContact(
      tenantId,
      msg.contactPhone,
      msg.pushName ?? null,
      msg.chatId ?? null,
    );
    const conversation = await this.upsertConversation(tenantId, instanceId, contact.id, isInbound);

    let mediaUrl: string | null = null;
    let mediaSize: number | null = null;
    const mediaMime: string | null = msg.media?.mime ?? null;
    if (msg.media?.data && msg.media.mime) {
      try {
        const persisted = await this.persistMedia(msg.media.data, msg.media.mime, msg.providerMsgId);
        mediaUrl = persisted.url;
        mediaSize = persisted.size;
      } catch (e) {
        this.logger.warn(`Falha ao persistir mídia: ${(e as Error).message}`);
      }
    }

    const created = await this.prisma.whatsappMessage.create({
      data: {
        conversationId: conversation.id,
        direction: msg.direction,
        type: msg.type,
        body: msg.body,
        mediaUrl,
        mediaMimeType: mediaMime,
        mediaSize,
        providerMsgId: msg.providerMsgId,
        status: 'DELIVERED',
      },
    });

    this.events.emit({
      type: 'message.created',
      tenantId,
      payload: {
        conversationId: conversation.id,
        messageId: created.id,
        direction: created.direction,
        type: created.type,
        body: created.body,
        mediaUrl: created.mediaUrl,
        createdAt: created.createdAt,
      },
    });
    this.events.emit({
      type: 'conversation.updated',
      tenantId,
      payload: {
        id: conversation.id,
        lastMessageAt: conversation.lastMessageAt,
        unreadCount: conversation.unreadCount,
        status: conversation.status,
      },
    });

    return { messageId: created.id, conversationId: conversation.id };
  }

  /** Atualiza status de entrega (DELIVERED/READ/FAILED). */
  async ingestStatus(tenantId: string, upd: CanonicalStatusUpdate) {
    if (!upd.providerMsgId || !upd.status) return;
    const msg = await this.prisma.whatsappMessage.findUnique({
      where: { providerMsgId: upd.providerMsgId },
    });
    if (!msg) return;

    // Não rebaixa status (READ não volta pra DELIVERED).
    const rank: Record<string, number> = { PENDING: 0, SENT: 1, DELIVERED: 2, READ: 3, FAILED: 4 };
    if ((rank[upd.status] ?? 0) <= (rank[msg.status] ?? 0) && upd.status !== 'FAILED') return;

    await this.prisma.whatsappMessage.update({
      where: { id: msg.id },
      data: { status: upd.status },
    });

    this.events.emit({
      type: 'message.updated',
      tenantId,
      payload: { id: msg.id, conversationId: msg.conversationId, status: upd.status },
    });
  }
}
