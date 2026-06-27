import { createHmac, timingSafeEqual } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import type { WaChannel, WaMsgType } from '@prisma/client';

import type {
  CanonicalConnection,
  CanonicalEvent,
  CanonicalMessage,
  ChannelProvider,
  DecryptedInstance,
  OutboundMedia,
  SendResult,
  TemplateSend,
} from './channel-provider';

const GRAPH_BASE = 'https://graph.facebook.com';
const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION ?? 'v20.0';

/**
 * Provider do canal OFICIAL — Meta Cloud API (WhatsApp Business Platform).
 *
 * Auth: Bearer `accessToken` (decifrado de apiCredentialsEnc). Webhook assinado
 * por HMAC-SHA256 em `X-Hub-Signature-256` usando o `appSecret`. Não há QR nem
 * "sessão": a instância está conectada enquanto o token é válido.
 *
 * Regras Meta: fora da janela de 24h (último inbound do cliente) só é possível
 * enviar TEMPLATE aprovado (HSM). A regra de janela mora no
 * WhatsappConversationsService; aqui implementamos os 3 modos de envio.
 *
 * Endpoints:
 *   POST /{phoneNumberId}/messages            — texto / mídia / template
 *   POST /{phoneNumberId}/media               — upload (multipart) → media id
 *   GET  /{mediaId}                            — metadados (url) da mídia
 *   GET  /{phoneNumberId}?fields=...           — valida token / número
 */
@Injectable()
export class MetaCloudProvider implements ChannelProvider {
  readonly channel: WaChannel = 'META_CLOUD';
  private readonly logger = new Logger(MetaCloudProvider.name);

  private url(path: string): string {
    return `${GRAPH_BASE}/${GRAPH_VERSION}${path}`;
  }

  private async graph<T = unknown>(
    accessToken: string,
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
    let res: Response;
    try {
      res = await fetch(this.url(path), {
        ...init,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...((init.headers as Record<string, string>) ?? {}),
        },
      });
    } catch (e) {
      throw new Error(`Meta Graph unreachable: ${(e as Error).message}`);
    }
    const text = await res.text();
    let body: any = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    if (!res.ok) {
      const msg = body?.error?.message ?? `HTTP ${res.status}`;
      this.logger.warn(`Meta ${init.method ?? 'GET'} ${path} → ${res.status} ${msg}`);
      throw new Error(`Meta: ${msg}`);
    }
    return body as T;
  }

  private requireMeta(inst: DecryptedInstance): { token: string; phoneNumberId: string } {
    if (!inst.accessToken || !inst.phoneNumberId) {
      throw new Error('Instância Meta sem accessToken/phoneNumberId configurados');
    }
    return { token: inst.accessToken, phoneNumberId: inst.phoneNumberId };
  }

  // ---- lifecycle (Meta não tem QR/sessão) ----

  async createSession(inst: DecryptedInstance): Promise<CanonicalConnection> {
    return this.connectionState(inst);
  }

  async getQr(inst: DecryptedInstance): Promise<CanonicalConnection> {
    return this.connectionState(inst);
  }

  async logout(): Promise<void> {
    /* no-op: token não desloga */
  }

  async deleteSession(): Promise<void> {
    /* no-op: remoção é só local */
  }

  async connectionState(inst: DecryptedInstance): Promise<CanonicalConnection> {
    const { token, phoneNumberId } = this.requireMeta(inst);
    try {
      const r = await this.graph<{ display_phone_number?: string; verified_name?: string }>(
        token,
        `/${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,verified_name`,
      );
      const phone = r?.display_phone_number ? '+' + r.display_phone_number.replace(/\D/g, '') : null;
      return { state: 'CONNECTED', phoneE164: phone };
    } catch (e) {
      return { state: 'ERROR', qrCode: null };
    }
  }

  // ---- envio ----

  private async send(inst: DecryptedInstance, payload: Record<string, unknown>): Promise<SendResult> {
    const { token, phoneNumberId } = this.requireMeta(inst);
    const res = await this.graph<{ messages?: Array<{ id?: string }> }>(
      token,
      `/${encodeURIComponent(phoneNumberId)}/messages`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }),
      },
    );
    return { providerMsgId: res?.messages?.[0]?.id ?? '' };
  }

  async sendText(inst: DecryptedInstance, toE164: string, text: string): Promise<SendResult> {
    return this.send(inst, {
      to: toE164.replace(/\D/g, ''),
      type: 'text',
      text: { body: text, preview_url: true },
    });
  }

  async sendMedia(inst: DecryptedInstance, toE164: string, media: OutboundMedia): Promise<SendResult> {
    // URL pública → link direto; base64/dataURI → upload e referencia por id.
    let ref: Record<string, unknown>;
    if (media.media.startsWith('http')) {
      ref = { link: media.media };
    } else {
      const mediaId = await this.uploadMedia(inst, media);
      ref = { id: mediaId };
    }
    if (media.caption && (media.mediatype === 'image' || media.mediatype === 'video' || media.mediatype === 'document')) {
      ref.caption = media.caption;
    }
    if (media.mediatype === 'document' && media.fileName) ref.filename = media.fileName;
    return this.send(inst, { to: toE164.replace(/\D/g, ''), type: media.mediatype, [media.mediatype]: ref });
  }

  async sendTemplate(inst: DecryptedInstance, toE164: string, tpl: TemplateSend): Promise<SendResult> {
    const components =
      tpl.variables && tpl.variables.length
        ? [{ type: 'body', parameters: tpl.variables.map((text) => ({ type: 'text', text })) }]
        : undefined;
    return this.send(inst, {
      to: toE164.replace(/\D/g, ''),
      type: 'template',
      template: {
        name: tpl.name,
        language: { code: tpl.language },
        ...(components ? { components } : {}),
      },
    });
  }

  private async uploadMedia(inst: DecryptedInstance, media: OutboundMedia): Promise<string> {
    const { token, phoneNumberId } = this.requireMeta(inst);
    const base64 = media.media.startsWith('data:') ? media.media.split(',')[1] : media.media;
    const buf = Buffer.from(base64, 'base64');
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', media.mimetype);
    form.append('file', new Blob([buf], { type: media.mimetype }), media.fileName ?? 'file');
    const res = await this.graph<{ id?: string }>(token, `/${encodeURIComponent(phoneNumberId)}/media`, {
      method: 'POST',
      body: form as unknown as BodyInit,
    });
    if (!res?.id) throw new Error('Meta media upload sem id');
    return res.id;
  }

  // ---- webhook ----

  verifyWebhook(
    inst: DecryptedInstance | null,
    headers: Record<string, string | undefined>,
    rawBody: Buffer,
  ): boolean {
    if (!inst?.appSecret) return false;
    const header = headers['x-hub-signature-256'];
    if (!header || !header.startsWith('sha256=')) return false;
    const sig = header.slice('sha256='.length);
    const expected = createHmac('sha256', inst.appSecret).update(rawBody).digest('hex');
    const a = Buffer.from(sig, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  parseWebhook(body: unknown): CanonicalEvent[] {
    const b = body as { entry?: Array<{ changes?: Array<{ value?: any }> }> };
    const events: CanonicalEvent[] = [];
    for (const entry of b?.entry ?? []) {
      for (const change of entry?.changes ?? []) {
        const v = change?.value ?? {};
        const nameByWaId = new Map<string, string>();
        for (const c of v.contacts ?? []) {
          if (c?.wa_id) nameByWaId.set(String(c.wa_id), c?.profile?.name ?? '');
        }
        for (const m of v.messages ?? []) {
          const msg = this.parseInboundMessage(m, nameByWaId);
          if (msg) events.push({ kind: 'message', data: msg });
        }
        for (const s of v.statuses ?? []) {
          const status = mapMetaStatus(s?.status);
          if (status && s?.id) events.push({ kind: 'status', data: { providerMsgId: s.id, status } });
        }
      }
    }
    return events;
  }

  private parseInboundMessage(m: any, names: Map<string, string>): CanonicalMessage | null {
    const id: string = m?.id;
    const from: string = m?.from;
    if (!id || !from) return null;
    const metaType: string = m?.type ?? 'text';

    let type: WaMsgType = 'UNKNOWN';
    let body: string | null = null;
    let media: CanonicalMessage['media'] = null;

    switch (metaType) {
      case 'text':
        type = 'TEXT';
        body = m.text?.body ?? null;
        break;
      case 'image':
      case 'video':
      case 'audio':
      case 'document':
      case 'sticker': {
        type = metaType === 'sticker' ? 'STICKER' : (metaType.toUpperCase() as WaMsgType);
        const node = m[metaType] ?? {};
        body = node.caption ?? null;
        media = { mediaId: node.id ?? null, mime: node.mime_type ?? 'application/octet-stream', fileName: node.filename ?? null };
        break;
      }
      case 'location':
        type = 'LOCATION';
        body = `${m.location?.latitude},${m.location?.longitude}`;
        break;
      case 'contacts':
        type = 'CONTACT';
        body = JSON.stringify(m.contacts ?? []);
        break;
      default:
        type = 'UNKNOWN';
        body = m?.[metaType] ? JSON.stringify(m[metaType]) : null;
    }

    return {
      providerMsgId: id,
      direction: 'IN', // Meta webhook só entrega inbound (não ecoa nossos envios)
      contactPhone: String(from),
      type,
      body,
      media,
      pushName: names.get(String(from)) || null,
      timestamp: m?.timestamp ? new Date(Number(m.timestamp) * 1000) : undefined,
    };
  }

  async downloadMedia(
    inst: DecryptedInstance,
    ref: { url?: string | null; mediaId?: string | null },
  ): Promise<{ base64: string; mime: string } | null> {
    if (!ref.mediaId) return null;
    const { token } = this.requireMeta(inst);
    try {
      const meta = await this.graph<{ url?: string; mime_type?: string }>(
        token,
        `/${encodeURIComponent(ref.mediaId)}`,
      );
      if (!meta?.url) return null;
      const res = await fetch(meta.url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return null;
      const mime = meta.mime_type ?? res.headers.get('content-type') ?? 'application/octet-stream';
      const buf = Buffer.from(await res.arrayBuffer());
      return { base64: buf.toString('base64'), mime };
    } catch (e) {
      this.logger.warn(`Meta downloadMedia falhou: ${(e as Error).message}`);
      return null;
    }
  }
}

function mapMetaStatus(s?: string): 'DELIVERED' | 'READ' | 'FAILED' | null {
  switch (s) {
    case 'delivered':
      return 'DELIVERED';
    case 'read':
      return 'READ';
    case 'failed':
      return 'FAILED';
    case 'sent':
    default:
      return null; // 'sent' não rebaixa o status local (já é SENT)
  }
}
