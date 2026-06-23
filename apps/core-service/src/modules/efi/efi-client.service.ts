/**
 * Cliente HTTP de baixo nível das APIs do EFI/EfiPay.
 *
 * - API Pix exige mTLS (certificado .p12) → usamos `node:https` com
 *   `https.Agent({ pfx, passphrase })`. O `fetch` global não aceita cert de
 *   cliente, por isso não o usamos aqui (diferente do UfinetClientService).
 * - API Cobranças (boleto/Bolix) é só Bearer, sem certificado.
 * - Token OAuth2 (HTTP Basic) cacheado em memória por (api|env|clientId),
 *   renovado 60s antes de expirar. Mesmas credenciais servem às duas APIs,
 *   mas os endpoints de token e o base URL diferem.
 *
 * Não decide política de erro: lança EfiApiError (status + corpo) e quem chama
 * (EfiChargesService) persiste em EfiCharge.lastError / status=ERROR.
 */
import * as https from 'node:https';
import { URL } from 'node:url';

import { Injectable, Logger } from '@nestjs/common';

import {
  EFI_COBRANCAS_BASE,
  EFI_PIX_BASE,
  type EfiBoletoOneStepResponse,
  type EfiNotificationResponse,
  type EfiPixCobResponse,
  type EfiPixQrCodeResponse,
  type EfiResolvedConfig,
} from './efi.types';

const TOKEN_TIMEOUT_MS = 15_000;
const API_TIMEOUT_MS = 30_000;
const TOKEN_SKEW_MS = 60_000;

export class EfiApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = 'EfiApiError';
  }
}

interface HttpsResult {
  status: number;
  text: string;
  json: unknown;
}

@Injectable()
export class EfiClientService {
  private readonly logger = new Logger(EfiClientService.name);
  private readonly tokenCache = new Map<string, { token: string; expiresAt: number }>();

  // ---------------------------------------------------------------------------
  // HTTPS cru (com suporte a mTLS via pfx)
  // ---------------------------------------------------------------------------
  private httpsJson(opts: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: string;
    pfx?: Buffer;
    passphrase?: string;
    timeoutMs: number;
  }): Promise<HttpsResult> {
    return new Promise((resolve, reject) => {
      let u: URL;
      try {
        u = new URL(opts.url);
      } catch (e) {
        reject(e);
        return;
      }
      const agent = opts.pfx
        ? new https.Agent({ pfx: opts.pfx, passphrase: opts.passphrase ?? '' })
        : undefined;
      const req = https.request(
        {
          method: opts.method,
          hostname: u.hostname,
          port: u.port || 443,
          path: u.pathname + u.search,
          headers: opts.headers,
          agent,
          timeout: opts.timeoutMs,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c) => chunks.push(c as Buffer));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            let json: unknown = null;
            try {
              json = text ? JSON.parse(text) : null;
            } catch {
              json = text;
            }
            resolve({ status: res.statusCode ?? 0, text, json });
          });
        },
      );
      req.on('error', reject);
      req.on('timeout', () => req.destroy(new Error('timeout')));
      if (opts.body) req.write(opts.body);
      req.end();
    });
  }

  private basicAuth(cfg: EfiResolvedConfig): string {
    const raw = `${cfg.credentials.clientId}:${cfg.credentials.clientSecret}`;
    return `Basic ${Buffer.from(raw).toString('base64')}`;
  }

  // ---------------------------------------------------------------------------
  // OAuth
  // ---------------------------------------------------------------------------
  private async getToken(cfg: EfiResolvedConfig, api: 'pix' | 'cobrancas'): Promise<string> {
    const key = `${api}|${cfg.environment}|${cfg.credentials.clientId}`;
    const cached = this.tokenCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.token;

    const isPix = api === 'pix';
    if (isPix && !cfg.certificate) {
      throw new EfiApiError('Certificado .p12 ausente — obrigatório para a API Pix do EFI', 0, null);
    }
    const base = isPix ? EFI_PIX_BASE[cfg.environment] : EFI_COBRANCAS_BASE[cfg.environment];
    const url = isPix ? `${base}/oauth/token` : `${base}/v1/authorize`;
    const body = JSON.stringify({ grant_type: 'client_credentials' });

    const res = await this.httpsJson({
      method: 'POST',
      url,
      headers: {
        Authorization: this.basicAuth(cfg),
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Content-Length': String(Buffer.byteLength(body)),
      },
      body,
      pfx: isPix ? cfg.certificate!.pfx : undefined,
      passphrase: isPix ? cfg.certificate!.passphrase : undefined,
      timeoutMs: TOKEN_TIMEOUT_MS,
    });

    const json = (res.json ?? {}) as { access_token?: string; expires_in?: number; error_description?: string; mensagem?: string };
    if (res.status < 200 || res.status >= 300 || !json.access_token) {
      this.logger.warn(`EFI ${api} OAuth → ${res.status}: ${json.error_description ?? json.mensagem ?? 'sem access_token'}`);
      throw new EfiApiError(`EFI ${api} OAuth falhou (${res.status})`, res.status, res.json);
    }
    const expiresInMs = (json.expires_in ?? 3600) * 1000;
    this.tokenCache.set(key, { token: json.access_token, expiresAt: Date.now() + expiresInMs - TOKEN_SKEW_MS });
    return json.access_token;
  }

  /**
   * Tenta obter um token OAuth e devolve o resultado estruturado — SEM lançar e
   * SEM cachear. Usado pelo diagnóstico "Testar conexão" (espelha o tokenProbe
   * do BTG): `api='pix'` valida também o certificado .p12 (mTLS); `api='cobrancas'`
   * valida só o par clientId/secret (Basic) da API de boleto.
   */
  async probeToken(
    cfg: EfiResolvedConfig,
    api: 'pix' | 'cobrancas',
  ): Promise<{ ok: boolean; status: number; body: unknown }> {
    const isPix = api === 'pix';
    if (isPix && !cfg.certificate) {
      return { ok: false, status: 0, body: { mensagem: 'Certificado .p12 ausente' } };
    }
    const base = isPix ? EFI_PIX_BASE[cfg.environment] : EFI_COBRANCAS_BASE[cfg.environment];
    const url = isPix ? `${base}/oauth/token` : `${base}/v1/authorize`;
    const body = JSON.stringify({ grant_type: 'client_credentials' });
    try {
      const res = await this.httpsJson({
        method: 'POST',
        url,
        headers: {
          Authorization: this.basicAuth(cfg),
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Content-Length': String(Buffer.byteLength(body)),
        },
        body,
        pfx: isPix ? cfg.certificate!.pfx : undefined,
        passphrase: isPix ? cfg.certificate!.passphrase : undefined,
        timeoutMs: TOKEN_TIMEOUT_MS,
      });
      const json = (res.json ?? {}) as { access_token?: string };
      const ok = res.status >= 200 && res.status < 300 && !!json.access_token;
      return { ok, status: res.status, body: res.json };
    } catch (e) {
      return { ok: false, status: 0, body: { mensagem: e instanceof Error ? e.message : String(e) } };
    }
  }

  /** Invalida o cache de token (usado quando as credenciais mudam). */
  clearTokenCache(clientId?: string): void {
    if (!clientId) {
      this.tokenCache.clear();
      return;
    }
    for (const k of this.tokenCache.keys()) {
      if (k.endsWith(`|${clientId}`)) this.tokenCache.delete(k);
    }
  }

  // ---------------------------------------------------------------------------
  // Requests genéricos
  // ---------------------------------------------------------------------------
  private async pixRequest<T>(
    cfg: EfiResolvedConfig,
    method: 'GET' | 'PUT' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<T> {
    const token = await this.getToken(cfg, 'pix');
    const base = EFI_PIX_BASE[cfg.environment];
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const res = await this.httpsJson({
      method,
      url: `${base}${path}`,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(payload)) } : {}),
      },
      body: payload,
      pfx: cfg.certificate!.pfx,
      passphrase: cfg.certificate!.passphrase,
      timeoutMs: API_TIMEOUT_MS,
    });
    if (res.status < 200 || res.status >= 300) {
      throw new EfiApiError(`EFI Pix ${method} ${path} → ${res.status}`, res.status, res.json);
    }
    return res.json as T;
  }

  private async cobrancasRequest<T>(
    cfg: EfiResolvedConfig,
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<T> {
    const token = await this.getToken(cfg, 'cobrancas');
    const base = EFI_COBRANCAS_BASE[cfg.environment];
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const res = await this.httpsJson({
      method,
      url: `${base}${path}`,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(payload)) } : {}),
      },
      body: payload,
      timeoutMs: API_TIMEOUT_MS,
    });
    if (res.status < 200 || res.status >= 300) {
      throw new EfiApiError(`EFI Cobranças ${method} ${path} → ${res.status}`, res.status, res.json);
    }
    return res.json as T;
  }

  // ---------------------------------------------------------------------------
  // API Pix
  // ---------------------------------------------------------------------------
  /** PUT /v2/cob/{txid} — cria cobrança imediata com txid próprio (idempotente). */
  createPixCob(cfg: EfiResolvedConfig, txid: string, payload: unknown): Promise<EfiPixCobResponse> {
    return this.pixRequest<EfiPixCobResponse>(cfg, 'PUT', `/v2/cob/${txid}`, payload);
  }

  /** GET /v2/cob/{txid} — consulta status. */
  getPixCob(cfg: EfiResolvedConfig, txid: string): Promise<EfiPixCobResponse> {
    return this.pixRequest<EfiPixCobResponse>(cfg, 'GET', `/v2/cob/${txid}`);
  }

  /** GET /v2/loc/{id}/qrcode — copia-e-cola + imagem do QR. */
  getPixQrCode(cfg: EfiResolvedConfig, locId: number | string): Promise<EfiPixQrCodeResponse> {
    return this.pixRequest<EfiPixQrCodeResponse>(cfg, 'GET', `/v2/loc/${locId}/qrcode`);
  }

  /** PUT /v2/webhook/{chave} — registra o webhook Pix para a chave recebedora. */
  registerPixWebhook(cfg: EfiResolvedConfig, chave: string, webhookUrl: string): Promise<unknown> {
    return this.pixRequest(cfg, 'PUT', `/v2/webhook/${encodeURIComponent(chave)}`, { webhookUrl });
  }

  // ---------------------------------------------------------------------------
  // API Cobranças (boleto/Bolix)
  // ---------------------------------------------------------------------------
  /** POST /v1/charge/one-step — emite boleto (com Pix embutido se a conta tem Bolix). */
  createBoletoOneStep(cfg: EfiResolvedConfig, payload: unknown): Promise<EfiBoletoOneStepResponse> {
    return this.cobrancasRequest<EfiBoletoOneStepResponse>(cfg, 'POST', '/v1/charge/one-step', payload);
  }

  /** GET /v1/notification/{token} — detalhes de uma notificação de cobrança. */
  getNotification(cfg: EfiResolvedConfig, token: string): Promise<EfiNotificationResponse> {
    return this.cobrancasRequest<EfiNotificationResponse>(cfg, 'GET', `/v1/notification/${encodeURIComponent(token)}`);
  }
}
