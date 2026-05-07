import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { Prisma, WaMsgType } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

import { WhatsappEventsBus } from './whatsapp-events.bus';

const MEDIA_ROOT = process.env.WHATSAPP_MEDIA_ROOT ?? '/var/lib/netx/whatsapp/media';

/**
 * Dispatcher de eventos vindos do Evolution. Recebe payloads "crus" do
 * webhook, converte pra formato canônico e persiste com dedup.
 *
 * Idempotência: `evolutionMsgId` é UNIQUE — webhook reentregue não duplica.
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
    const existingOpen = await this.prisma.whatsappConversation.findFirst({
      where: { instanceId, contactId, status: { in: ['OPEN', 'RESOLVED'] } },
      orderBy: { lastMessageAt: 'desc' },
    });

    if (existingOpen) {
      const updates: Prisma.WhatsappConversationUpdateInput = {
        lastMessageAt: new Date(),
        ...(isInbound
          ? { lastInboundAt: new Date(), unreadCount: { increment: 1 } }
          : {}),
      };
      // Re-abre se estava resolvida e cliente mandou nova msg
      if (existingOpen.status === 'RESOLVED' && isInbound) {
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
  ) {
    const digits = phoneE164.replace(/\D/g, '');
    const e164 = `+${digits}`;

    const existing = await this.prisma.whatsappContact.findUnique({
      where: { tenantId_phoneE164: { tenantId, phoneE164: e164 } },
    });
    if (existing) {
      // Atualiza pushName se mudou
      if (pushName && pushName !== existing.pushName) {
        return this.prisma.whatsappContact.update({
          where: { id: existing.id },
          data: { pushName },
        });
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
   * Handler principal de `messages.upsert` do Evolution.
   *
   * Payload (simplificado):
   * {
   *   key: { remoteJid, fromMe, id },
   *   pushName,
   *   message: { conversation?, imageMessage?, audioMessage?, ... },
   *   messageType,
   *   messageTimestamp
   * }
   */
  async handleIncoming(
    instanceId: string,
    tenantId: string,
    raw: any,
  ): Promise<{ messageId: string; conversationId: string } | null> {
    const key = raw?.key ?? {};
    if (!key.remoteJid || !key.id) {
      this.logger.warn('messages.upsert sem key.remoteJid/id — ignorando');
      return null;
    }

    // Ignora mensagens de grupos/broadcast no MVP
    if (typeof key.remoteJid === 'string' && key.remoteJid.endsWith('@g.us')) {
      this.logger.debug('Mensagem de grupo ignorada');
      return null;
    }

    const phoneE164 = (key.remoteJid as string).split('@')[0];
    const isInbound = !key.fromMe;

    // Dedup: já tem essa mensagem?
    const existing = await this.prisma.whatsappMessage.findUnique({
      where: { evolutionMsgId: key.id },
    });
    if (existing) return { messageId: existing.id, conversationId: existing.conversationId };

    const contact = await this.upsertContact(tenantId, phoneE164, raw.pushName ?? null);
    const conversation = await this.upsertConversation(tenantId, instanceId, contact.id, isInbound);

    // Decode tipo + corpo
    const { type, body, mediaBase64, mediaMime } = this.parseMessage(raw.message ?? {});

    let mediaUrl: string | null = null;
    let mediaSize: number | null = null;
    if (mediaBase64 && mediaMime) {
      try {
        const persisted = await this.persistMedia(mediaBase64, mediaMime, key.id);
        mediaUrl = persisted.url;
        mediaSize = persisted.size;
      } catch (e) {
        this.logger.warn(`Falha ao persistir mídia: ${(e as Error).message}`);
      }
    }

    const created = await this.prisma.whatsappMessage.create({
      data: {
        conversationId: conversation.id,
        direction: isInbound ? 'IN' : 'OUT',
        type,
        body,
        mediaUrl,
        mediaMimeType: mediaMime,
        mediaSize,
        evolutionMsgId: key.id,
        status: 'DELIVERED',
      },
    });

    // Emite SSE
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

  /**
   * Atualiza status de mensagem (DELIVERED/READ).
   */
  async handleStatusUpdate(tenantId: string, raw: any) {
    const keyId = raw?.keyId ?? raw?.key?.id;
    const status = raw?.status?.toUpperCase?.();
    if (!keyId || !status) return;

    const allowed = ['DELIVERED', 'READ', 'FAILED'];
    if (!allowed.includes(status)) return;

    const msg = await this.prisma.whatsappMessage.findUnique({
      where: { evolutionMsgId: keyId },
    });
    if (!msg) return;

    await this.prisma.whatsappMessage.update({
      where: { id: msg.id },
      data: { status: status as any },
    });

    this.events.emit({
      type: 'message.updated',
      tenantId,
      payload: { id: msg.id, conversationId: msg.conversationId, status },
    });
  }

  // -- helpers --

  private parseMessage(message: Record<string, unknown>): {
    type: WaMsgType;
    body: string | null;
    mediaBase64: string | null;
    mediaMime: string | null;
  } {
    if (typeof (message as any).conversation === 'string') {
      return { type: 'TEXT', body: (message as any).conversation, mediaBase64: null, mediaMime: null };
    }
    if ((message as any).extendedTextMessage?.text) {
      return {
        type: 'TEXT',
        body: (message as any).extendedTextMessage.text,
        mediaBase64: null,
        mediaMime: null,
      };
    }
    if ((message as any).imageMessage) {
      const im = (message as any).imageMessage;
      return {
        type: 'IMAGE',
        body: im.caption ?? null,
        mediaBase64: im.base64 ?? im.url ?? null,
        mediaMime: im.mimetype ?? 'image/jpeg',
      };
    }
    if ((message as any).audioMessage) {
      const am = (message as any).audioMessage;
      return {
        type: 'AUDIO',
        body: null,
        mediaBase64: am.base64 ?? am.url ?? null,
        mediaMime: am.mimetype ?? 'audio/ogg',
      };
    }
    if ((message as any).videoMessage) {
      const vm = (message as any).videoMessage;
      return {
        type: 'VIDEO',
        body: vm.caption ?? null,
        mediaBase64: vm.base64 ?? vm.url ?? null,
        mediaMime: vm.mimetype ?? 'video/mp4',
      };
    }
    if ((message as any).documentMessage) {
      const dm = (message as any).documentMessage;
      return {
        type: 'DOCUMENT',
        body: dm.fileName ?? dm.caption ?? null,
        mediaBase64: dm.base64 ?? dm.url ?? null,
        mediaMime: dm.mimetype ?? 'application/octet-stream',
      };
    }
    if ((message as any).locationMessage) {
      const lm = (message as any).locationMessage;
      return {
        type: 'LOCATION',
        body: `${lm.degreesLatitude},${lm.degreesLongitude}`,
        mediaBase64: null,
        mediaMime: null,
      };
    }
    if ((message as any).stickerMessage) {
      return { type: 'STICKER', body: null, mediaBase64: null, mediaMime: null };
    }
    return { type: 'UNKNOWN', body: null, mediaBase64: null, mediaMime: null };
  }
}
