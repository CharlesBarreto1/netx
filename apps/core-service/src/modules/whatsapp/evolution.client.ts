import { Injectable, Logger } from '@nestjs/common';

/**
 * Wrapper HTTP do Evolution API v2.
 *
 * Documentação: https://doc.evolution-api.com/
 * Endpoints usados:
 *   POST /instance/create                    — cria/conecta instância
 *   GET  /instance/connectionState/{name}    — status atual
 *   GET  /instance/connect/{name}            — força reconexão (devolve QR)
 *   DELETE /instance/logout/{name}           — desconecta sessão (mantém instância)
 *   DELETE /instance/delete/{name}           — apaga instância
 *   POST /webhook/set/{name}                 — configura webhook por instância
 *   POST /message/sendText/{name}            — envia texto
 *   POST /message/sendMedia/{name}           — envia mídia
 *
 * Autenticação: header `apikey: <APIKEY>`. A APIKEY pode ser global
 * (`AUTHENTICATION_API_KEY` do Evolution) ou por instância (mais seguro).
 * No NetX usamos a global definida no instalador, persistida em
 * `WhatsappInstance.apiKey`.
 *
 * Erros: Evolution retorna 4xx/5xx com `{ status, message }`. Convertemos
 * em Error normal — quem chama decide se é warning ou crítico.
 */

export interface EvolutionInstanceState {
  state: 'connecting' | 'open' | 'close';
  qrcode?: { code: string; base64: string };
}

export interface SendTextResponse {
  key: { id: string; remoteJid: string; fromMe: boolean };
  status: string;
}

export interface SendMediaResponse {
  key: { id: string; remoteJid: string; fromMe: boolean };
  status: string;
}

@Injectable()
export class EvolutionClient {
  private readonly logger = new Logger(EvolutionClient.name);

  private async req<T = unknown>(
    baseUrl: string,
    apiKey: string,
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
    const url = `${baseUrl.replace(/\/$/, '')}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      apikey: apiKey,
      ...((init.headers as Record<string, string>) ?? {}),
    };
    let res: Response;
    try {
      res = await fetch(url, { ...init, headers });
    } catch (e) {
      throw new Error(`Evolution unreachable at ${url}: ${(e as Error).message}`);
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
        (body && typeof body === 'object' && 'message' in body
          ? String((body as { message: unknown }).message)
          : null) ?? `HTTP ${res.status}`;
      this.logger.warn(`Evolution ${init.method ?? 'GET'} ${path} → ${res.status} ${msg}`);
      throw new Error(`Evolution: ${msg}`);
    }
    return body as T;
  }

  // ---- Instância ----

  async createInstance(
    baseUrl: string,
    apiKey: string,
    instanceName: string,
    webhookUrl?: string,
    webhookSecret?: string,
  ): Promise<EvolutionInstanceState> {
    const body: Record<string, unknown> = {
      instanceName,
      qrcode: true,
      integration: 'WHATSAPP-BAILEYS',
    };
    if (webhookUrl) {
      body.webhook = {
        url: webhookUrl,
        events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CONNECTION_UPDATE', 'CONTACTS_UPSERT'],
        webhook_by_events: false,
        webhook_base64: true,
        ...(webhookSecret ? { headers: { apikey: webhookSecret } } : {}),
      };
    }
    return this.req(baseUrl, apiKey, '/instance/create', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async connectionState(baseUrl: string, apiKey: string, instanceName: string) {
    return this.req<{ instance: { state: string } }>(
      baseUrl,
      apiKey,
      `/instance/connectionState/${encodeURIComponent(instanceName)}`,
    );
  }

  async connect(baseUrl: string, apiKey: string, instanceName: string) {
    return this.req<EvolutionInstanceState>(
      baseUrl,
      apiKey,
      `/instance/connect/${encodeURIComponent(instanceName)}`,
    );
  }

  async logout(baseUrl: string, apiKey: string, instanceName: string) {
    return this.req(baseUrl, apiKey, `/instance/logout/${encodeURIComponent(instanceName)}`, {
      method: 'DELETE',
    });
  }

  async deleteInstance(baseUrl: string, apiKey: string, instanceName: string) {
    return this.req(baseUrl, apiKey, `/instance/delete/${encodeURIComponent(instanceName)}`, {
      method: 'DELETE',
    });
  }

  // ---- Webhook ----

  async setWebhook(
    baseUrl: string,
    apiKey: string,
    instanceName: string,
    webhookUrl: string,
    webhookSecret?: string,
  ) {
    return this.req(baseUrl, apiKey, `/webhook/set/${encodeURIComponent(instanceName)}`, {
      method: 'POST',
      body: JSON.stringify({
        webhook: {
          enabled: true,
          url: webhookUrl,
          events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CONNECTION_UPDATE', 'CONTACTS_UPSERT'],
          webhook_by_events: false,
          webhook_base64: true,
          ...(webhookSecret ? { headers: { apikey: webhookSecret } } : {}),
        },
      }),
    });
  }

  // ---- Send ----

  /**
   * Envia mensagem de texto.
   * `to` deve ser número E164 sem `+` (ex: "595981234567").
   */
  async sendText(
    baseUrl: string,
    apiKey: string,
    instanceName: string,
    to: string,
    text: string,
  ): Promise<SendTextResponse> {
    return this.req(baseUrl, apiKey, `/message/sendText/${encodeURIComponent(instanceName)}`, {
      method: 'POST',
      body: JSON.stringify({
        number: to.replace(/\D/g, ''),
        text,
      }),
    });
  }

  /**
   * Envia mídia (imagem/áudio/vídeo/documento) por base64 ou URL.
   */
  async sendMedia(
    baseUrl: string,
    apiKey: string,
    instanceName: string,
    to: string,
    options: {
      mediatype: 'image' | 'video' | 'document' | 'audio';
      mimetype: string;
      caption?: string;
      fileName?: string;
      media: string; // URL ou base64 dataURI
    },
  ): Promise<SendMediaResponse> {
    return this.req(baseUrl, apiKey, `/message/sendMedia/${encodeURIComponent(instanceName)}`, {
      method: 'POST',
      body: JSON.stringify({
        number: to.replace(/\D/g, ''),
        ...options,
      }),
    });
  }
}
