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
} from './channel-provider';

/**
 * Provider do WAHA (WhatsApp HTTP API — https://waha.devlike.pro/).
 *
 * Substitui o antigo Evolution API (que virou licença paga na v2.4.0). WAHA é
 * grátis, open-source, multi-sessão por container. API REST com header
 * `X-Api-Key`. Webhook assinado por HMAC-SHA512 (`X-Webhook-Hmac`) usando o
 * `webhookSecret` por instância.
 *
 * Endpoints usados:
 *   POST   /api/sessions                       — cria sessão (config + webhooks)
 *   POST   /api/sessions/{name}/start          — inicia
 *   GET    /api/sessions/{name}                — status + me{ id, pushName }
 *   GET    /api/{name}/auth/qr?format=image    — QR base64
 *   POST   /api/sessions/{name}/logout         — desloga (mantém sessão)
 *   DELETE /api/sessions/{name}                — apaga sessão
 *   POST   /api/sendText                       — { session, chatId, text }
 *   POST   /api/sendImage|sendFile|sendVoice|sendVideo
 *
 * Provider SEM estado: tudo vem da DecryptedInstance.
 */
@Injectable()
export class WahaProvider implements ChannelProvider {
  readonly channel: WaChannel = 'WAHA';
  private readonly logger = new Logger(WahaProvider.name);

  // ---- HTTP ----

  private async req<T = unknown>(
    inst: DecryptedInstance,
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
    const url = `${inst.baseUrl.replace(/\/$/, '')}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Api-Key': inst.apiKey,
      ...((init.headers as Record<string, string>) ?? {}),
    };
    let res: Response;
    try {
      res = await fetch(url, { ...init, headers });
    } catch (e) {
      throw new Error(`WAHA unreachable at ${url}: ${(e as Error).message}`);
    }
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    if (!res.ok) {
      const msg =
        body && typeof body === 'object' && 'message' in body
          ? String((body as { message: unknown }).message)
          : `HTTP ${res.status}`;
      this.logger.warn(`WAHA ${init.method ?? 'GET'} ${path} → ${res.status} ${msg}`);
      throw new Error(`WAHA: ${msg}`);
    }
    return body as T;
  }

  /** `<phone>@c.us` a partir de E164 (só dígitos). */
  private chatId(toE164: string): string {
    return `${toE164.replace(/\D/g, '')}@c.us`;
  }

  // ---- lifecycle ----

  async createSession(inst: DecryptedInstance, webhookUrl: string): Promise<CanonicalConnection> {
    // Idempotente: cria a config com webhook HMAC e dá start. Se já existe,
    // WAHA retorna 422/409 — tratamos como ok e seguimos pro start.
    const config = {
      webhooks: [
        {
          url: webhookUrl,
          events: ['message', 'message.ack', 'session.status'],
          hmac: { key: inst.webhookSecret },
        },
      ],
    };
    try {
      await this.req(inst, '/api/sessions', {
        method: 'POST',
        body: JSON.stringify({ name: inst.instanceName, start: true, config }),
      });
    } catch (e) {
      // Sessão já existente: garante config + start mesmo assim.
      this.logger.debug(`createSession (segue p/ start): ${(e as Error).message}`);
      try {
        await this.req(inst, `/api/sessions/${encodeURIComponent(inst.instanceName)}/start`, {
          method: 'POST',
        });
      } catch {
        /* já iniciada */
      }
    }
    return this.getQr(inst);
  }

  async getQr(inst: DecryptedInstance): Promise<CanonicalConnection> {
    // Primeiro confere status; se já WORKING, não há QR.
    const state = await this.connectionState(inst);
    if (state.state === 'CONNECTED') return state;
    try {
      const qr = await this.req<{ mimetype?: string; data?: string }>(
        inst,
        `/api/${encodeURIComponent(inst.instanceName)}/auth/qr?format=image`,
      );
      const data = qr?.data ?? null;
      return {
        state: 'CONNECTING',
        qrCode: data ? `data:${qr.mimetype ?? 'image/png'};base64,${data}` : null,
      };
    } catch (e) {
      this.logger.warn(`WAHA getQr falhou: ${(e as Error).message}`);
      return { state: state.state, qrCode: null };
    }
  }

  async logout(inst: DecryptedInstance): Promise<void> {
    await this.req(inst, `/api/sessions/${encodeURIComponent(inst.instanceName)}/logout`, {
      method: 'POST',
    });
  }

  async deleteSession(inst: DecryptedInstance): Promise<void> {
    await this.req(inst, `/api/sessions/${encodeURIComponent(inst.instanceName)}`, {
      method: 'DELETE',
    });
  }

  async connectionState(inst: DecryptedInstance): Promise<CanonicalConnection> {
    const s = await this.req<{ status?: string; me?: { id?: string; pushName?: string } }>(
      inst,
      `/api/sessions/${encodeURIComponent(inst.instanceName)}`,
    );
    return {
      state: mapWahaStatus(s?.status),
      phoneE164: s?.me?.id ? '+' + String(s.me.id).split('@')[0].replace(/\D/g, '') : null,
    };
  }

  // ---- envio ----

  async sendText(inst: DecryptedInstance, toE164: string, text: string): Promise<SendResult> {
    const res = await this.req<{ id?: string | { id?: string } }>(inst, '/api/sendText', {
      method: 'POST',
      body: JSON.stringify({
        session: inst.instanceName,
        chatId: this.chatId(toE164),
        text,
      }),
    });
    return { providerMsgId: extractMsgId(res) };
  }

  async sendMedia(inst: DecryptedInstance, toE164: string, media: OutboundMedia): Promise<SendResult> {
    const endpoint =
      media.mediatype === 'image'
        ? '/api/sendImage'
        : media.mediatype === 'video'
        ? '/api/sendVideo'
        : media.mediatype === 'audio'
        ? '/api/sendVoice'
        : '/api/sendFile';
    // WAHA aceita file por url ou por data (base64 puro, sem dataURI prefix).
    const isDataUri = media.media.startsWith('data:');
    const file = isDataUri
      ? { mimetype: media.mimetype, filename: media.fileName, data: media.media.split(',')[1] }
      : media.media.startsWith('http')
      ? { mimetype: media.mimetype, filename: media.fileName, url: media.media }
      : { mimetype: media.mimetype, filename: media.fileName, data: media.media };
    const res = await this.req<{ id?: string | { id?: string } }>(inst, endpoint, {
      method: 'POST',
      body: JSON.stringify({
        session: inst.instanceName,
        chatId: this.chatId(toE164),
        file,
        caption: media.caption,
      }),
    });
    return { providerMsgId: extractMsgId(res) };
  }

  sendTemplate(): Promise<SendResult> {
    // WAHA é sessão pessoal: não há HSM/janela 24h. Não deve ser chamado.
    throw new Error('WAHA não suporta templates HSM (use o canal META_CLOUD).');
  }

  // ---- webhook ----

  verifyWebhook(
    inst: DecryptedInstance | null,
    headers: Record<string, string | undefined>,
    rawBody: Buffer,
  ): boolean {
    if (!inst) return false;
    const sig = headers['x-webhook-hmac'];
    if (!sig) {
      this.logger.warn('Webhook WAHA sem X-Webhook-Hmac');
      return false;
    }
    const expected = createHmac('sha512', inst.webhookSecret).update(rawBody).digest('hex');
    const a = Buffer.from(sig, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  parseWebhook(body: unknown): CanonicalEvent[] {
    const b = body as { event?: string; payload?: any };
    const event = b?.event ?? '';
    const p = b?.payload ?? {};

    if (event === 'message' || event === 'message.any') {
      const msg = this.parseMessagePayload(p);
      return msg ? [{ kind: 'message', data: msg }] : [];
    }

    if (event === 'message.ack') {
      const status = mapWahaAck(p?.ack ?? p?.ackName);
      const id = extractIncomingId(p?.id);
      if (status && id) return [{ kind: 'status', data: { providerMsgId: id, status } }];
      return [];
    }

    if (event === 'session.status') {
      return [{ kind: 'connection', data: { state: mapWahaStatus(p?.status) } }];
    }

    return [];
  }

  private parseMessagePayload(p: any): CanonicalMessage | null {
    const from: string = p?.from ?? '';
    const id = extractIncomingId(p?.id);
    if (!from || !id) return null;
    // Ignora grupos/broadcast no MVP.
    if (from.endsWith('@g.us') || from.endsWith('@broadcast') || from.includes('status@')) {
      return null;
    }
    const contactPhone = from.split('@')[0];
    const fromMe = Boolean(p?.fromMe);

    let type: WaMsgType = 'TEXT';
    let body: string | null = p?.body ?? null;
    let media: CanonicalMessage['media'] = null;

    if (p?.hasMedia && p?.media) {
      const mime: string = p.media.mimetype ?? 'application/octet-stream';
      type = mimeToType(mime);
      body = p?.caption ?? p?.body ?? null;
      media = { url: p.media.url ?? null, mime, fileName: p.media.filename ?? null };
    } else if (p?.location) {
      type = 'LOCATION';
      body = `${p.location.latitude},${p.location.longitude}`;
    }

    return {
      providerMsgId: id,
      direction: fromMe ? 'OUT' : 'IN',
      contactPhone,
      type,
      body,
      media,
      pushName: p?.notifyName ?? p?._data?.notifyName ?? null,
      timestamp: p?.timestamp ? new Date(Number(p.timestamp) * 1000) : undefined,
    };
  }

  async downloadMedia(
    inst: DecryptedInstance,
    ref: { url?: string | null; mediaId?: string | null },
  ): Promise<{ base64: string; mime: string } | null> {
    if (!ref.url) return null;
    try {
      const res = await fetch(ref.url, { headers: { 'X-Api-Key': inst.apiKey } });
      if (!res.ok) return null;
      const mime = res.headers.get('content-type') ?? 'application/octet-stream';
      const buf = Buffer.from(await res.arrayBuffer());
      return { base64: buf.toString('base64'), mime };
    } catch (e) {
      this.logger.warn(`WAHA downloadMedia falhou: ${(e as Error).message}`);
      return null;
    }
  }
}

// ---- helpers de mapeamento ----

function mapWahaStatus(s?: string): CanonicalConnection['state'] {
  switch (s) {
    case 'WORKING':
      return 'CONNECTED';
    case 'SCAN_QR_CODE':
    case 'STARTING':
      return 'CONNECTING';
    case 'FAILED':
      return 'ERROR';
    case 'STOPPED':
    default:
      return 'DISCONNECTED';
  }
}

function mapWahaAck(ack: unknown): 'DELIVERED' | 'READ' | 'FAILED' | null {
  if (typeof ack === 'string') {
    const a = ack.toUpperCase();
    if (a === 'SERVER' || a === 'DEVICE') return 'DELIVERED';
    if (a === 'READ' || a === 'PLAYED') return 'READ';
    if (a === 'ERROR') return 'FAILED';
    return null;
  }
  if (typeof ack === 'number') {
    if (ack === -1) return 'FAILED';
    if (ack === 2) return 'DELIVERED';
    if (ack >= 3) return 'READ';
  }
  return null;
}

function mimeToType(mime: string): WaMsgType {
  if (mime.startsWith('image/')) return mime.includes('webp') ? 'STICKER' : 'IMAGE';
  if (mime.startsWith('audio/')) return 'AUDIO';
  if (mime.startsWith('video/')) return 'VIDEO';
  return 'DOCUMENT';
}

/** WAHA devolve id como string ou objeto `{ id }` / `{ _serialized }`. */
function extractIncomingId(id: unknown): string | null {
  if (typeof id === 'string') return id;
  if (id && typeof id === 'object') {
    const o = id as { id?: string; _serialized?: string };
    return o._serialized ?? o.id ?? null;
  }
  return null;
}

function extractMsgId(res: { id?: string | { id?: string; _serialized?: string } }): string {
  const id = res?.id;
  if (typeof id === 'string') return id;
  if (id && typeof id === 'object') return id._serialized ?? id.id ?? '';
  return '';
}
